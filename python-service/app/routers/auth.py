import os
import time

from fastapi import APIRouter, HTTPException, Request

from ..db import get_db
from ..models.user_profile import (
    AuthTokenResponse,
    UserLoginRequest,
    UserProfile,
    UserSignupRequest,
)
from ..services.user_profile_service import (
    fetch_profile_by_username,
    hash_password,
    increment_rate,
    issue_token,
    normalize_avatar,
    now_ms,
    password_strength,
    redact_profile_document,
    verify_password,
)


router = APIRouter()


@router.post("/auth/signup", response_model=AuthTokenResponse)
async def signup(body: UserSignupRequest, request: Request):
    db = get_db()
    ip = request.client.host if request.client else "unknown"
    if not increment_rate(f"signup:{ip}"):
        raise HTTPException(status_code=429, detail="rate limit exceeded")

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username required")

    existing = await fetch_profile_by_username(db, username)
    if existing:
        raise HTTPException(status_code=409, detail="username already taken")

    if not password_strength(body.password):
        raise HTTPException(
            status_code=400,
            detail="password too weak (need mix of cases, digits or symbols)",
        )

    user_id = f"u_{int(time.time()*1000)}_{os.urandom(4).hex()}"
    created_at = now_ms()
    avatar_url = await normalize_avatar(body.avatar_url)

    profile_doc = {
        "userId": user_id,
        "username": username,
        "usernameLower": username.lower(),
        "passwordHash": hash_password(body.password),
        "avatarUrl": avatar_url,
        "friends": [],
        "createdAt": created_at,
        "updatedAt": created_at,
    }

    await db["profiles"].insert_one(profile_doc)

    token = issue_token(user_id, username)
    payload = redact_profile_document(profile_doc)
    profile = UserProfile(**payload)
    return AuthTokenResponse(token=token, profile=profile)


@router.post("/auth/login", response_model=AuthTokenResponse)
async def login(body: UserLoginRequest, request: Request):
    db = get_db()
    ip = request.client.host if request.client else "unknown"
    if not increment_rate(f"login:{ip}"):
        raise HTTPException(status_code=429, detail="rate limit exceeded")

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username required")

    profile_doc = await fetch_profile_by_username(db, username)
    if not profile_doc:
        raise HTTPException(status_code=404, detail="user not found")

    if not verify_password(body.password, profile_doc.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="invalid credentials")

    token = issue_token(profile_doc["userId"], profile_doc["username"])
    payload = redact_profile_document(profile_doc)
    profile = UserProfile(**payload)
    return AuthTokenResponse(token=token, profile=profile)
