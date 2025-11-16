from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .identifiers import PyObjectId


class UserSignupRequest(BaseModel):
    """Payload for creating a new user via the public sign-up flow."""

    model_config = ConfigDict(populate_by_name=True)

    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")


class UserLoginRequest(BaseModel):
    """Credentials provided during login."""

    username: str
    password: str


class UserProfileDocument(BaseModel):
    """Canonical representation of a user profile document stored in MongoDB."""

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId = Field(alias="_id")
    user_id: str = Field(alias="userId")
    username: str
    username_lower: str = Field(alias="usernameLower")
    password_hash: str = Field(alias="passwordHash")
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")
    friends: List[str] = Field(default_factory=list)
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")


class UserProfile(BaseModel):
    """Public-facing user profile returned to clients."""

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId = Field(alias="_id")
    user_id: str = Field(alias="userId")
    username: str
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")
    friends: List[str] = Field(default_factory=list)
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")


class AuthTokenResponse(BaseModel):
    """Response envelope for authentication endpoints."""

    token: str
    profile: UserProfile


class UserProfilePatch(BaseModel):
    """Mutable fields for partial profile updates."""

    model_config = ConfigDict(populate_by_name=True)

    username: Optional[str] = Field(default=None, min_length=3, max_length=32)
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")
    friends: Optional[List[str]] = None


__all__ = [
    "AuthTokenResponse",
    "UserLoginRequest",
    "UserProfile",
    "UserProfileDocument",
    "UserProfilePatch",
    "UserSignupRequest",
]
