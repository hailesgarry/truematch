from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional
from urllib.parse import quote as url_quote

import bcrypt
import jwt

from ..config import get_settings
from ..db import get_user_db
from ..models.user_profile import (
    UserLoginRequest,
    UserProfileDocument,
    UserProfilePatch,
    UserSignupRequest,
)
from ..repositories.exceptions import DuplicateKeyRepositoryError, NotFoundRepositoryError
from ..repositories.user_profile import UserProfileRepository


class RateLimiter:
    """Very small in-memory rate limiter for authentication flows."""

    def __init__(self, window_seconds: int, max_attempts: int) -> None:
        self._window = float(window_seconds)
        self._max_attempts = max_attempts
        self._state: Dict[str, Dict[str, float]] = {}

    def increment(self, key: str) -> bool:
        now = time.time()
        record = self._state.get(key)
        if not record or record.get("expires", 0) < now:
            record = {"count": 0.0, "expires": now + self._window}
        record["count"] = record.get("count", 0.0) + 1.0
        self._state[key] = record
        return record["count"] <= self._max_attempts


class UserProfileService:
    """High-level orchestration for user profile create/read/update flows."""

    def __init__(
        self,
        repository: UserProfileRepository,
        *,
        jwt_secret: str,
        token_ttl_seconds: int,
        rate_limit_window: int,
        rate_limit_max: int,
    ) -> None:
        self._repository = repository
        self._jwt_secret = jwt_secret
        self._token_ttl = token_ttl_seconds
        self._rate_limiter = RateLimiter(rate_limit_window, rate_limit_max)

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    @staticmethod
    def _generate_user_id() -> str:
        return f"u_{int(time.time()*1000)}_{os.urandom(4).hex()}"

    @staticmethod
    def hash_password(raw: str) -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(raw.encode("utf-8"), salt).decode("utf-8")

    @staticmethod
    def verify_password(raw: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
        except Exception:
            return False

    @staticmethod
    def password_strength(password: str) -> bool:
        score = 0
        if any(c.islower() for c in password):
            score += 1
        if any(c.isupper() for c in password):
            score += 1
        if any(c.isdigit() for c in password):
            score += 1
        if any(c in "!@#$%^&*()-_=+[]{};:,<.>/?" for c in password):
            score += 1
        return score >= 3 and len(password) >= 8

    def allow_rate(self, key: str) -> bool:
        return self._rate_limiter.increment(key)

    def issue_token(self, user_id: str, username: str) -> str:
        now = int(time.time())
        payload = {
            "sub": user_id,
            "username": username,
            "iat": now,
            "exp": now + self._token_ttl,
        }
        return jwt.encode(payload, self._jwt_secret, algorithm="HS256")

    def decode_token(self, token: str) -> Optional[Dict[str, Any]]:
        try:
            return jwt.decode(token, self._jwt_secret, algorithms=["HS256"])
        except Exception:
            return None

    async def get_profile_from_token(self, token: str) -> Optional[UserProfileDocument]:
        if not token:
            return None
        payload = self.decode_token(token)
        if not payload:
            return None
        user_id = str(payload.get("sub") or "").strip()
        if not user_id:
            return None
        return await self._repository.get_by_user_id(user_id)

    async def get_by_user_id(self, user_id: str) -> Optional[UserProfileDocument]:
        if not user_id:
            return None
        return await self._repository.get_by_user_id(user_id)

    async def get_by_username(self, username: str) -> Optional[UserProfileDocument]:
        if not username:
            return None
        text = username.strip()
        if not text:
            return None
        return await self._repository.get_by_username(text)

    async def normalize_avatar(self, raw_avatar: Optional[str]) -> Optional[str]:
        if not raw_avatar or not isinstance(raw_avatar, str):
            return None

        candidate = raw_avatar.strip()
        if not candidate:
            return None

        from ..integrations.cloudinary import (
            ensure_configured as cloud_ensure,
            is_enabled as cloud_enabled,
            upload_data_url as cloud_upload_data_url,
        )

        try:
            data_to_upload: Optional[str] = None
            lowered = candidate.lower()
            if lowered.startswith("data:image/"):
                data_to_upload = candidate
            elif candidate.startswith("<svg"):
                data_to_upload = f"data:image/svg+xml;utf8,{url_quote(candidate)}"
            elif lowered.startswith("http://") or lowered.startswith("https://"):
                data_to_upload = candidate

            if data_to_upload and cloud_enabled():
                cloud_ensure()
                uploaded = cloud_upload_data_url(
                    data_to_upload,
                    folder=os.getenv("CLOUDINARY_AVATAR_FOLDER", "funly/avatars"),
                    resource_type="image",
                    eager=[
                        {
                            "width": 256,
                            "height": 256,
                            "crop": "fill",
                            "gravity": "auto",
                            "format": "webp",
                            "quality": "auto",
                        }
                    ],
                    eager_async=False,
                )
                if uploaded:
                    return uploaded
        except Exception:
            pass

        return candidate

    async def register_user(self, payload: UserSignupRequest) -> UserProfileDocument:
        username = payload.username.strip()
        if not username:
            raise ValueError("username required")
        if await self._repository.username_exists(username):
            raise DuplicateKeyRepositoryError("username already taken")
        if not self.password_strength(payload.password):
            raise ValueError("weak password")

        user_id = self._generate_user_id()
        now_ms = self._now_ms()
        avatar_url = await self.normalize_avatar(payload.avatar_url)
        hashed = self.hash_password(payload.password)

        return await self._repository.create_profile(
            user_id=user_id,
            username=username,
            password_hash=hashed,
            avatar_url=avatar_url,
            friends=None,
            created_at=now_ms,
            updated_at=now_ms,
        )

    async def authenticate_user(self, payload: UserLoginRequest) -> UserProfileDocument:
        username = payload.username.strip()
        if not username:
            raise ValueError("username required")
        profile = await self._repository.get_by_username(username)
        if not profile:
            raise NotFoundRepositoryError("user not found")
        if not self.verify_password(payload.password, profile.password_hash):
            raise PermissionError("invalid credentials")
        return profile

    async def ensure_username_available(
        self,
        username: str,
        *,
        exclude_user_id: Optional[str] = None,
    ) -> bool:
        return not await self._repository.username_exists(
            username,
            exclude_user_id=exclude_user_id,
        )

    async def update_profile(
        self,
        user_id: str,
        patch: UserProfilePatch,
    ) -> UserProfileDocument:
        updates: Dict[str, Any] = {}

        if patch.username is not None:
            username = patch.username.strip()
            if not username:
                raise ValueError("username required")
            if not await self.ensure_username_available(username, exclude_user_id=user_id):
                raise DuplicateKeyRepositoryError("username already taken")
            updates["username"] = username
            updates["usernameLower"] = username.lower()

        if patch.avatar_url is not None:
            updates["avatarUrl"] = await self.normalize_avatar(patch.avatar_url)

        if patch.friends is not None:
            deduped: list[str] = []
            seen = set()
            for entry in patch.friends:
                if not isinstance(entry, str):
                    continue
                cleaned = entry.strip()
                if not cleaned or cleaned in seen:
                    continue
                deduped.append(cleaned)
                seen.add(cleaned)
                if len(deduped) >= 100:
                    break
            updates["friends"] = deduped

        if not updates:
            profile = await self._repository.get_by_user_id(user_id)
            if not profile:
                raise NotFoundRepositoryError("user not found")
            return profile

        updates["updatedAt"] = self._now_ms()
        return await self._repository.update_profile(user_id=user_id, updates=updates)

    @staticmethod
    def redact_profile_document(doc: UserProfileDocument) -> Dict[str, Any]:
        data = doc.model_dump(by_alias=True)
        data.pop("passwordHash", None)
        return data


def get_user_profile_service() -> UserProfileService:
    settings = get_settings()
    repository = UserProfileRepository(get_user_db())
    return UserProfileService(
        repository,
        jwt_secret=settings.jwt_secret,
        token_ttl_seconds=settings.auth_token_ttl,
        rate_limit_window=settings.auth_rate_limit_window,
        rate_limit_max=settings.auth_rate_limit_max,
    )


async def get_current_profile(token: str) -> Optional[Dict[str, Any]]:
    """Backwards-compatible helper used by legacy callers."""

    service = get_user_profile_service()
    doc = await service.get_profile_from_token(token)
    if not doc:
        return None
    return service.redact_profile_document(doc)


__all__ = ["UserProfileService", "get_current_profile", "get_user_profile_service"]
