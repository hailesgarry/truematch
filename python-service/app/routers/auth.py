from fastapi import APIRouter, HTTPException, Depends, Request, Header
from pydantic import BaseModel, Field
from typing import Optional
from ..db import get_db
import time, os, bcrypt, jwt
from ..integrations.cloudinary import (
    is_enabled as cloud_enabled,
    ensure_configured as cloud_ensure,
    upload_data_url as cloud_upload_data_url,
)
from urllib.parse import quote as url_quote

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL", "86400"))  # 24h

router = APIRouter() 

class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    avatarUrl: Optional[str] = Field(None, description="Optional initial avatar URL")

class LoginRequest(BaseModel):
    username: str
    password: str

class ProfileResponse(BaseModel):
    userId: str
    username: str
    avatarUrl: Optional[str] = None
    friends: list[str] = Field(default_factory=list)
    createdAt: int
    updatedAt: int

class TokenResponse(BaseModel):
    token: str
    profile: ProfileResponse

def _hash_password(raw: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(raw.encode("utf-8"), salt).decode("utf-8")

def _verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def _issue_token(user_id: str, username: str) -> str:
    now = int(time.time())
    payload = {"sub": user_id, "username": username, "iat": now, "exp": now + TOKEN_TTL_SECONDS}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def _get_profile_by_username(db, username: str):
    return await db["profiles"].find_one({"usernameLower": username.lower()})


async def _get_profile_by_user_id(db, user_id: str):
    return await db["profiles"].find_one({"userId": user_id})

_rate_limiter_cache = {}
RATE_LIMIT_WINDOW = int(os.getenv("AUTH_RATE_LIMIT_WINDOW", "60"))  # seconds
RATE_LIMIT_MAX = int(os.getenv("AUTH_RATE_LIMIT_MAX", "20"))  # max attempts per window

def _increment_rate(ip: str) -> bool:
    now = time.time()
    rec = _rate_limiter_cache.get(ip)
    if not rec or rec["expires"] < now:
        rec = {"count": 0, "expires": now + RATE_LIMIT_WINDOW}
    rec["count"] += 1
    _rate_limiter_cache[ip] = rec
    return rec["count"] <= RATE_LIMIT_MAX

def _password_strength(pw: str):
    score = 0
    if any(c.islower() for c in pw): score += 1
    if any(c.isupper() for c in pw): score += 1
    if any(c.isdigit() for c in pw): score += 1
    if any(c in "!@#$%^&*()-_=+[]{};:,<.>/?" for c in pw): score += 1
    return score >= 3 and len(pw) >= 8

@router.post("/auth/signup", response_model=TokenResponse)
async def signup(body: SignupRequest, request: Request):
    db = get_db()
    ip = request.client.host if request.client else "unknown"
    if not _increment_rate(f"signup:{ip}"):
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    uname = body.username.strip()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    if await _get_profile_by_username(db, uname):
        raise HTTPException(status_code=409, detail="username already taken")
    if not _password_strength(body.password):
        raise HTTPException(status_code=400, detail="password too weak (need mix of cases, digits or symbols)")
    user_id = f"u_{int(time.time()*1000)}_{os.urandom(4).hex()}"
    now = int(time.time()*1000)
    # Normalize avatar: if a data URL was provided, upload it to Cloudinary and store the hosted URL
    avatar_url: Optional[str] = body.avatarUrl or None
    try:
        if avatar_url and isinstance(avatar_url, str):
            raw = avatar_url.strip()
            data_to_upload: Optional[str] = None
            low = raw.lower()
            if low.startswith("data:image/"):
                data_to_upload = raw
            elif raw.startswith("<svg"):
                # Convert raw SVG markup to data URL
                data_to_upload = f"data:image/svg+xml;utf8,{url_quote(raw)}"
            elif low.startswith("http://") or low.startswith("https://"):
                # Allow remote URLs (e.g., Dicebear) to be uploaded by Cloudinary directly
                data_to_upload = raw

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
                    avatar_url = uploaded
    except Exception:
        # Non-fatal: if upload fails, keep original value (or None)
        pass
    doc = {
        "userId": user_id,
        "username": uname,
        "usernameLower": uname.lower(),
        "passwordHash": _hash_password(body.password),
        "avatarUrl": avatar_url or None,
        "friends": [],
        "createdAt": now,
        "updatedAt": now,
    }
    await db["profiles"].insert_one(doc)
    token = _issue_token(user_id, uname)
    return TokenResponse(token=token, profile=ProfileResponse(**doc))

@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request):
    db = get_db()
    ip = request.client.host if request.client else "unknown"
    if not _increment_rate(f"login:{ip}"):
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    uname = body.username.strip()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    prof = await _get_profile_by_username(db, uname)
    if not prof:
        raise HTTPException(status_code=404, detail="user not found")
    if not _verify_password(body.password, prof.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = _issue_token(prof["userId"], prof["username"])
    return TokenResponse(token=token, profile=ProfileResponse(**prof))

def _decode_token(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        return None

async def get_current_profile(token: str) -> Optional[dict]:
    db = get_db()
    data = _decode_token(token)
    if not data:
        return None
    prof = await db["profiles"].find_one({"userId": data.get("sub")})
    return prof

@router.get("/profiles/me", response_model=ProfileResponse)
async def me(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len("Bearer ") :].strip()
    prof = await get_current_profile(token)
    if not prof:
        raise HTTPException(status_code=401, detail="invalid token")
    return ProfileResponse(**prof)

@router.get("/profiles/id/{user_id}", response_model=ProfileResponse)
async def profile_by_id(user_id: str):
    db = get_db()
    prof = await _get_profile_by_user_id(db, user_id.strip())
    if not prof:
        raise HTTPException(status_code=404, detail="not found")
    prof.pop("passwordHash", None)
    return ProfileResponse(**prof)


@router.get("/profiles/{username}", response_model=ProfileResponse)
async def profile(username: str):
    db = get_db()
    prof = await _get_profile_by_username(db, username.strip())
    if not prof:
        raise HTTPException(status_code=404, detail="not found")
    # Redact passwordHash
    prof.pop("passwordHash", None)
    return ProfileResponse(**prof)

class ProfilePatch(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=32)
    avatarUrl: Optional[str] = None
    friends: Optional[list[str]] = None

@router.patch("/profiles/me", response_model=ProfileResponse)
async def update_me(patch: ProfilePatch, authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len("Bearer ") :].strip()
    prof = await get_current_profile(token)
    if not prof:
        raise HTTPException(status_code=401, detail="invalid token")
    db = get_db()
    updates = {}
    # Username change (optional)
    if patch.username is not None:
        uname = patch.username.strip()
        if not uname:
            raise HTTPException(status_code=400, detail="username required")
        # Only check uniqueness if different (case-insensitive)
        if uname.lower() != prof.get("usernameLower", "").lower():
            # Ensure new username isn't taken by another user
            exists = await db["profiles"].find_one(
                {"usernameLower": uname.lower(), "userId": {"$ne": prof["userId"]}}
            )
            if exists:
                raise HTTPException(status_code=409, detail="username already taken")
        updates["username"] = uname
        updates["usernameLower"] = uname.lower()
    if patch.avatarUrl is not None:
        # Normalize and upload avatar when a data URL is provided
        new_avatar: Optional[str] = patch.avatarUrl or None
        try:
            if isinstance(new_avatar, str):
                raw = new_avatar.strip()
                low = raw.lower()
                data_to_upload: Optional[str] = None
                if low.startswith("data:image/"):
                    data_to_upload = raw
                elif raw.startswith("<svg"):
                    data_to_upload = f"data:image/svg+xml;utf8,{url_quote(raw)}"
                elif low.startswith("http://") or low.startswith("https://"):
                    data_to_upload = raw

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
                        new_avatar = uploaded
        except Exception:
            # Non-fatal; keep provided value or clear if empty
            pass
        updates["avatarUrl"] = new_avatar or None
    if patch.friends is not None:
        # Deduplicate & limit
        dedup = []
        seen = set()
        for f in patch.friends:
            f = f.strip()
            if not f or f in seen:
                continue
            dedup.append(f)
            seen.add(f)
            if len(dedup) >= 100:
                break
        updates["friends"] = dedup
    if updates:
        updates["updatedAt"] = int(time.time()*1000)
        await db["profiles"].update_one({"userId": prof["userId"]}, {"$set": updates})
        prof.update(updates)
    prof.pop("passwordHash", None)
    return ProfileResponse(**prof)
