import os
import time
from typing import Any, Dict, Optional
from urllib.parse import quote as url_quote

import bcrypt
import jwt

from ..db import get_db
from ..integrations.cloudinary import (
    ensure_configured as cloud_ensure,
    is_enabled as cloud_enabled,
    upload_data_url as cloud_upload_data_url,
)

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL", "86400"))

_RATE_LIMIT_WINDOW = int(os.getenv("AUTH_RATE_LIMIT_WINDOW", "60"))
_RATE_LIMIT_MAX = int(os.getenv("AUTH_RATE_LIMIT_MAX", "20"))
_rate_limiter_cache: Dict[str, Dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def hash_password(raw: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(raw.encode("utf-8"), salt).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def issue_token(user_id: str, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "username": username,
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        return None


def increment_rate(key: str) -> bool:
    now = time.time()
    record = _rate_limiter_cache.get(key)
    if not record or record.get("expires", 0) < now:
        record = {"count": 0, "expires": now + _RATE_LIMIT_WINDOW}
    record["count"] += 1
    _rate_limiter_cache[key] = record
    return record["count"] <= _RATE_LIMIT_MAX


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


async def fetch_profile_by_username(db, username: str) -> Optional[Dict[str, Any]]:
    if not username:
        return None
    return await db["profiles"].find_one({"usernameLower": username.lower()})


async def fetch_profile_by_user_id(db, user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    return await db["profiles"].find_one({"userId": user_id})


async def get_current_profile(token: str, db=None) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    data = decode_token(token)
    if not data:
        return None
    if db is None:
        db = get_db()
    return await fetch_profile_by_user_id(db, str(data.get("sub")))


async def ensure_username_available(db, username: str, *, exclude_user_id: Optional[str] = None) -> bool:
    if not username:
        return False
    query: Dict[str, Any] = {"usernameLower": username.lower()}
    if exclude_user_id:
        query["userId"] = {"$ne": exclude_user_id}
    existing = await db["profiles"].find_one(query, projection={"_id": 1})
    return existing is None


def redact_profile_document(doc: Dict[str, Any]) -> Dict[str, Any]:
    filtered = dict(doc)
    filtered.pop("passwordHash", None)
    return filtered


def now_ms() -> int:
    return _now_ms()


async def normalize_avatar(raw_avatar: Optional[str]) -> Optional[str]:
    if not raw_avatar or not isinstance(raw_avatar, str):
        return None

    candidate = raw_avatar.strip()
    if not candidate:
        return None

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
        # Non-fatal; fall back to original value
        pass

    return candidate


__all__ = [
    "hash_password",
    "verify_password",
    "issue_token",
    "decode_token",
    "increment_rate",
    "password_strength",
    "fetch_profile_by_username",
    "fetch_profile_by_user_id",
    "get_current_profile",
    "ensure_username_available",
    "redact_profile_document",
    "now_ms",
    "normalize_avatar",
]
