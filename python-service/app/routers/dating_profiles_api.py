"""Modern dating profile REST endpoints backed by repository/services."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..models.dating_profile import (
    DatingProfile,
    DatingProfileCreateRequest,
    DatingProfileUpsert,
)
from ..repositories.exceptions import NotFoundRepositoryError
from ..services.dating_profile_service import (
    DatingProfileService,
    get_dating_profile_service,
)

router = APIRouter(prefix="/dating-profiles", tags=["dating-profiles"]) 


@router.post("", response_model=DatingProfile, status_code=status.HTTP_201_CREATED)
async def create_dating_profile(
    payload: DatingProfileCreateRequest,
    service: DatingProfileService = Depends(get_dating_profile_service),
) -> DatingProfile:
    user_id = payload.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId required")

    upsert_payload = DatingProfileUpsert(**payload.model_dump(by_alias=True, exclude={"userId"}))

    try:
        document = await service.upsert_profile(user_id=user_id, payload=upsert_payload)
    except NotFoundRepositoryError:
        raise HTTPException(status_code=404, detail="user profile not found") from None

    return DatingProfile(**document.model_dump(by_alias=True, round_trip=True))


@router.get("/{user_id}", response_model=DatingProfile)
async def get_dating_profile(
    user_id: str,
    service: DatingProfileService = Depends(get_dating_profile_service),
) -> DatingProfile:
    doc = await service.get_profile_document(user_id.strip())
    if not doc:
        raise HTTPException(status_code=404, detail="profile not found")
    return DatingProfile(**doc.model_dump(by_alias=True, round_trip=True))


@router.patch("/{user_id}", response_model=DatingProfile)
async def update_dating_profile(
    user_id: str,
    payload: DatingProfileUpsert,
    service: DatingProfileService = Depends(get_dating_profile_service),
) -> DatingProfile:
    try:
        document = await service.upsert_profile(user_id=user_id.strip(), payload=payload)
    except NotFoundRepositoryError:
        raise HTTPException(status_code=404, detail="user profile not found") from None

    return DatingProfile(**document.model_dump(by_alias=True, round_trip=True))


__all__ = ["router"]
