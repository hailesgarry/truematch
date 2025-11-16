from fastapi import APIRouter, Depends, Header, HTTPException

from ..models.user_profile import UserProfile, UserProfilePatch
from ..repositories.exceptions import DuplicateKeyRepositoryError, NotFoundRepositoryError
from ..services.user_profile_service import (
    UserProfileService,
    get_user_profile_service,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("/me", response_model=UserProfile)
async def me(
    authorization: str = Header(default=""),
    service: UserProfileService = Depends(get_user_profile_service),
):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization[len("Bearer ") :].strip()
    profile_doc = await service.get_profile_from_token(token)
    if not profile_doc:
        raise HTTPException(status_code=401, detail="invalid token")

    payload = service.redact_profile_document(profile_doc)
    return UserProfile(**payload)


@router.get("/id/{user_id}", response_model=UserProfile)
async def profile_by_id(
    user_id: str,
    service: UserProfileService = Depends(get_user_profile_service),
):
    profile_doc = await service.get_by_user_id(user_id.strip())
    if not profile_doc:
        raise HTTPException(status_code=404, detail="not found")

    payload = service.redact_profile_document(profile_doc)
    return UserProfile(**payload)


@router.get("/{username}", response_model=UserProfile)
async def profile(
    username: str,
    service: UserProfileService = Depends(get_user_profile_service),
):
    profile_doc = await service.get_by_username(username.strip())
    if not profile_doc:
        raise HTTPException(status_code=404, detail="not found")

    payload = service.redact_profile_document(profile_doc)
    return UserProfile(**payload)


@router.patch("/me", response_model=UserProfile)
async def update_me(
    patch: UserProfilePatch,
    authorization: str = Header(default=""),
    service: UserProfileService = Depends(get_user_profile_service),
):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization[len("Bearer ") :].strip()
    profile_doc = await service.get_profile_from_token(token)
    if not profile_doc:
        raise HTTPException(status_code=401, detail="invalid token")

    try:
        updated_profile = await service.update_profile(profile_doc.user_id, patch)
    except DuplicateKeyRepositoryError:
        raise HTTPException(status_code=409, detail="username already taken") from None
    except NotFoundRepositoryError:
        raise HTTPException(status_code=404, detail="not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = service.redact_profile_document(updated_profile)
    return UserProfile(**payload)


__all__ = ["router"]
