from fastapi import APIRouter, Header, HTTPException

from ..db import get_db
from ..models.user_profile import UserProfile, UserProfilePatch
from ..services.user_profile_service import (
    ensure_username_available,
    fetch_profile_by_user_id,
    fetch_profile_by_username,
    get_current_profile,
    normalize_avatar,
    now_ms,
    redact_profile_document,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("/me", response_model=UserProfile)
async def me(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization[len("Bearer ") :].strip()
    db = get_db()
    profile_doc = await get_current_profile(token, db)
    if not profile_doc:
        raise HTTPException(status_code=401, detail="invalid token")

    payload = redact_profile_document(profile_doc)
    return UserProfile(**payload)


@router.get("/id/{user_id}", response_model=UserProfile)
async def profile_by_id(user_id: str):
    db = get_db()
    profile_doc = await fetch_profile_by_user_id(db, user_id.strip())
    if not profile_doc:
        raise HTTPException(status_code=404, detail="not found")

    payload = redact_profile_document(profile_doc)
    return UserProfile(**payload)


@router.get("/{username}", response_model=UserProfile)
async def profile(username: str):
    db = get_db()
    profile_doc = await fetch_profile_by_username(db, username.strip())
    if not profile_doc:
        raise HTTPException(status_code=404, detail="not found")

    payload = redact_profile_document(profile_doc)
    return UserProfile(**payload)


@router.patch("/me", response_model=UserProfile)
async def update_me(patch: UserProfilePatch, authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization[len("Bearer ") :].strip()
    db = get_db()
    profile_doc = await get_current_profile(token, db)
    if not profile_doc:
        raise HTTPException(status_code=401, detail="invalid token")

    updates = {}

    if patch.username is not None:
        username = patch.username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="username required")

        if username.lower() != profile_doc.get("usernameLower", "").lower():
            available = await ensure_username_available(
                db,
                username,
                exclude_user_id=profile_doc.get("userId"),
            )
            if not available:
                raise HTTPException(status_code=409, detail="username already taken")

        updates["username"] = username
        updates["usernameLower"] = username.lower()

    if patch.avatar_url is not None:
        updates["avatarUrl"] = await normalize_avatar(patch.avatar_url)

    if patch.friends is not None:
        deduped = []
        seen = set()
        for entry in patch.friends:
            entry = entry.strip()
            if not entry or entry in seen:
                continue
            deduped.append(entry)
            seen.add(entry)
            if len(deduped) >= 100:
                break
        updates["friends"] = deduped

    if updates:
        updates["updatedAt"] = now_ms()
        await db["profiles"].update_one(
            {"userId": profile_doc["userId"]},
            {"$set": updates},
        )
        profile_doc.update(updates)

    payload = redact_profile_document(profile_doc)
    return UserProfile(**payload)


__all__ = ["router"]
