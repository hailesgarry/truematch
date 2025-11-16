from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from ..db import get_dating_db, get_user_db
from ..models.dating_profile import (
    DatingProfile,
    DatingProfileDocument,
    DatingProfileUpsert,
)
from ..models.user_profile import UserProfileDocument
from ..repositories.dating_profile import DatingProfileRepository
from ..repositories.exceptions import NotFoundRepositoryError
from ..repositories.user_profile import UserProfileRepository


def _clean_str(value: Any, max_len: Optional[int] = None) -> Optional[str]:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if max_len is not None and len(text) > max_len:
            text = text[:max_len]
        return text
    return None


def _normalize_photo_list(raw: Any, limit: int = 24) -> List[str]:
    photos: List[str] = []
    if isinstance(raw, (list, tuple)):
        for entry in raw:
            cleaned = _clean_str(entry, max_len=512)
            if not cleaned or cleaned in photos:
                continue
            photos.append(cleaned)
            if len(photos) >= limit:
                break
    return photos


def _extract_primary_photo(doc: Dict[str, Any]) -> Optional[str]:
    for key in ("primaryPhotoUrl", "primaryPhoto", "photoUrl", "photo"):
        cleaned = _clean_str(doc.get(key), max_len=512)
        if cleaned:
            return cleaned
    photos = _normalize_photo_list(doc.get("photos"))
    return photos[0] if photos else None


def resolve_primary_photo(doc: Optional[Dict[str, Any]]) -> Optional[str]:
    if not doc:
        return None
    photo = _extract_primary_photo(doc)
    if photo:
        return photo
    photos = _normalize_photo_list(doc.get("photos"))
    return photos[0] if photos else None


class DatingProfileService:
    """Business logic for dating profile CRUD operations."""

    def __init__(
        self,
        dating_repo: DatingProfileRepository,
        user_repo: UserProfileRepository,
    ) -> None:
        self._dating_repo = dating_repo
        self._user_repo = user_repo

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    async def get_profile_document(self, user_id: str) -> Optional[DatingProfileDocument]:
        if not user_id:
            return None
        return await self._dating_repo.get_by_user_id(user_id)

    async def get_profile(self, user_id: str) -> Optional[DatingProfile]:
        doc = await self.get_profile_document(user_id)
        if not doc:
            return None
        return DatingProfile(**doc.model_dump(by_alias=True))

    async def upsert_profile(
        self,
        user_id: str,
        payload: DatingProfileUpsert,
    ) -> DatingProfileDocument:
        user_profile = await self._user_repo.get_by_user_id(user_id)
        if not user_profile:
            raise NotFoundRepositoryError("user profile not found")

        updates = self._build_updates(payload, user_profile)
        now_ms = self._now_ms()
        document = await self._dating_repo.upsert_profile(
            user_profile_id=user_profile.id,
            user_id=user_profile.user_id,
            updates=updates,
            updated_at=now_ms,
            created_at=now_ms,
        )

        try:
            await self._user_repo.update_profile(
                user_id=user_profile.user_id,
                updates={"hasDatingProfile": True, "updatedAt": now_ms},
            )
        except NotFoundRepositoryError:  # pragma: no cover - defensive guard
            pass

        return document

    def _build_updates(
        self,
        payload: DatingProfileUpsert,
        user_profile: UserProfileDocument,
    ) -> Dict[str, Any]:
        updates: Dict[str, Any] = {}

        first_name = payload.first_name
        if first_name is None:
            extra = getattr(payload, "model_extra", None) or {}
            candidate = extra.get("displayName") or extra.get("name")
            first_name = _clean_str(candidate, max_len=80)
        else:
            first_name = _clean_str(first_name, max_len=80)

        if not first_name:
            # Attempt to read from user profile extras when available
            candidate = getattr(user_profile, "model_extra", None)
            if isinstance(candidate, dict):
                first_name = _clean_str(candidate.get("firstName") or candidate.get("displayName"), max_len=80)

        if not first_name:
            first_name = _clean_str(user_profile.username, max_len=80)

        if first_name:
            updates["firstName"] = first_name

        primary_photo = payload.primary_photo_url
        if primary_photo is not None:
            updates["primaryPhotoUrl"] = _clean_str(primary_photo, max_len=512)

        photos = _normalize_photo_list(payload.photos)
        if photos:
            updates["photos"] = photos

        if payload.is_active is not None:
            updates["isActive"] = bool(payload.is_active)

        if payload.bio is not None:
            updates["bio"] = _clean_str(payload.bio, max_len=600)

        # Always persist the legacy-friendly identifiers consumers rely on
        updates["userId"] = user_profile.user_id

        for deprecated in ("username", "displayName", "name", "photo", "photoUrl", "hasDatingProfile"):
            updates.pop(deprecated, None)

        return {key: value for key, value in updates.items() if value is not None}


def get_dating_profile_service() -> DatingProfileService:
    dating_repo = DatingProfileRepository(get_dating_db())
    user_repo = UserProfileRepository(get_user_db())
    return DatingProfileService(dating_repo=dating_repo, user_repo=user_repo)


__all__ = [
    "DatingProfileService",
    "get_dating_profile_service",
    "resolve_primary_photo",
]
