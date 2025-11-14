from fastapi import APIRouter, Depends, Header, HTTPException, status

from ..db import get_db
from ..models.likes import (
    LikeRemovalResponse,
    LikeRequest,
    LikeResponse,
    LikesReceivedResponse,
    MatchesResponse,
)
from ..routers.auth import get_current_profile
from ..services.likes_service import (
    get_likes_received,
    get_matches,
    record_like,
    remove_like,
)

router = APIRouter(prefix="/likes", tags=["likes"])

def _extract_token(authorization: str) -> str:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    return token

async def require_current_profile(authorization: str = Header(default="")) -> dict:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authorization required")
    token = _extract_token(authorization)
    profile = await get_current_profile(token)
    if not profile:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    return profile

@router.post("", response_model=LikeResponse)
async def create_like(
    payload: LikeRequest,
    current_profile: dict = Depends(require_current_profile),
):
    db = get_db()
    liker_id = (current_profile.get("userId") or "").strip()
    if not liker_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="profile missing userId")

    target_user_id = (payload.target_user_id or "").strip()

    if not target_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_user_id required")
    if liker_id == target_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot like yourself")

    target_profile = await db["profiles"].find_one({"userId": target_user_id}, projection={"_id": 1})
    if not target_profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target user not found")

    try:
        _, is_match = await record_like(db, liker_id, target_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return LikeResponse(is_match=is_match)


@router.delete("/{target_user_id}", response_model=LikeRemovalResponse)
async def delete_like(
    target_user_id: str,
    current_profile: dict = Depends(require_current_profile),
):
    db = get_db()
    liker_id = (current_profile.get("userId") or "").strip()
    if not liker_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="profile missing userId")

    target = (target_user_id or "").strip()
    if not target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_user_id required")
    if target == liker_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot unlike yourself")

    removed = await remove_like(db, liker_id, target)
    return LikeRemovalResponse(removed=removed)

@router.get("/me", response_model=LikesReceivedResponse)
async def list_likes_received(
    current_profile: dict = Depends(require_current_profile),
):
    db = get_db()
    user_id = (current_profile.get("userId") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="profile missing userId")
    liked_me = await get_likes_received(db, user_id)
    return LikesReceivedResponse(liked_me=liked_me)

@router.get("/matches", response_model=MatchesResponse)
async def list_matches(
    current_profile: dict = Depends(require_current_profile),
):
    db = get_db()
    user_id = (current_profile.get("userId") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="profile missing userId")
    matches = await get_matches(db, user_id)
    return MatchesResponse(matches=matches)

__all__ = ["router"]
