from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..models.dating_profile import DatingProfile

DATING_PROFILES_COLLECTION = "dating_profiles"


def _clean_str(value: Any) -> Optional[str]:
    if isinstance(value, str):
        text = value.strip()
        if text:
            return text
    return None


def _normalize_photo_list(raw: Any) -> List[str]:
    photos: List[str] = []
    if isinstance(raw, (list, tuple)):
        for entry in raw:
            cleaned = _clean_str(entry)
            if not cleaned or cleaned in photos:
                continue
            photos.append(cleaned)
            if len(photos) >= 24:
                break
    return photos


def _extract_primary_photo(doc: Dict[str, Any]) -> Optional[str]:
    for key in ("primaryPhotoUrl", "primaryPhoto", "photoUrl", "photo"):
        cleaned = _clean_str(doc.get(key))
        if cleaned:
            return cleaned
    photos = _normalize_photo_list(doc.get("photos"))
    return photos[0] if photos else None


def _convert_legacy_profile(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    candidate = {
        "userId": doc.get("userId"),
        "username": doc.get("username"),
        "displayName": doc.get("displayName") or doc.get("name"),
        "primaryPhotoUrl": _extract_primary_photo(doc),
        "photos": _normalize_photo_list(doc.get("photos")),
        "isActive": bool(doc.get("hasDatingProfile")),
        "bio": doc.get("bio"),
        "updatedAt": doc.get("updatedAt"),
    }
    if not candidate.get("userId"):
        return None
    return candidate


def _normalize_dating_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(doc)
    normalized["userId"] = _clean_str(normalized.get("userId")) or ""
    normalized["username"] = _clean_str(normalized.get("username"))
    normalized["displayName"] = _clean_str(normalized.get("displayName"))
    normalized["primaryPhotoUrl"] = _clean_str(normalized.get("primaryPhotoUrl"))
    normalized["photos"] = _normalize_photo_list(normalized.get("photos"))
    normalized["isActive"] = bool(normalized.get("isActive") or normalized.get("active"))
    return normalized


async def fetch_dating_profile_doc(db, user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    doc = await db[DATING_PROFILES_COLLECTION].find_one({"userId": user_id})
    if doc:
        return _normalize_dating_doc(doc)
    legacy = await db["profiles"].find_one({"userId": user_id})
    if not legacy:
        return None
    converted = _convert_legacy_profile(legacy)
    if not converted:
        return None
    return _normalize_dating_doc(converted)


async def fetch_dating_profile(db, user_id: str) -> Optional[DatingProfile]:
    doc = await fetch_dating_profile_doc(db, user_id)
    if not doc:
        return None
    return DatingProfile(**doc)


def resolve_primary_photo(doc: Optional[Dict[str, Any]]) -> Optional[str]:
    if not doc:
        return None
    photo = _extract_primary_photo(doc)
    if photo:
        return photo
    photos = _normalize_photo_list(doc.get("photos"))
    return photos[0] if photos else None


__all__ = [
    "DATING_PROFILES_COLLECTION",
    "fetch_dating_profile_doc",
    "fetch_dating_profile",
    "resolve_primary_photo",
]
