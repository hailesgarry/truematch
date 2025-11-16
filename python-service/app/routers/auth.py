from fastapi import APIRouter, Depends, HTTPException, Request

from ..models.user_profile import (
    AuthTokenResponse,
    UserLoginRequest,
    UserProfile,
    UserSignupRequest,
)
from ..repositories.exceptions import (
    DuplicateKeyRepositoryError,
    NotFoundRepositoryError,
)
from ..services.user_profile_service import (
    UserProfileService,
    get_user_profile_service,
)


router = APIRouter()


@router.post("/auth/signup", response_model=AuthTokenResponse)
async def signup(
    body: UserSignupRequest,
    request: Request,
    service: UserProfileService = Depends(get_user_profile_service),
):
    ip = request.client.host if request.client else "unknown"
    if not service.allow_rate(f"signup:{ip}"):
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    try:
        profile_doc = await service.register_user(body)
    except DuplicateKeyRepositoryError:
        raise HTTPException(status_code=409, detail="username already taken") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token = service.issue_token(profile_doc.user_id, profile_doc.username)
    payload = service.redact_profile_document(profile_doc)
    profile = UserProfile(**payload)
    return AuthTokenResponse(token=token, profile=profile)


@router.post("/auth/login", response_model=AuthTokenResponse)
async def login(
    body: UserLoginRequest,
    request: Request,
    service: UserProfileService = Depends(get_user_profile_service),
):
    ip = request.client.host if request.client else "unknown"
    if not service.allow_rate(f"login:{ip}"):
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    try:
        profile_doc = await service.authenticate_user(body)
    except NotFoundRepositoryError:
        raise HTTPException(status_code=404, detail="user not found") from None
    except PermissionError:
        raise HTTPException(status_code=401, detail="invalid credentials") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token = service.issue_token(profile_doc.user_id, profile_doc.username)
    payload = service.redact_profile_document(profile_doc)
    profile = UserProfile(**payload)
    return AuthTokenResponse(token=token, profile=profile)
