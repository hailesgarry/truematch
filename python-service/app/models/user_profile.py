from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class UserSignupRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")


class UserLoginRequest(BaseModel):
    username: str
    password: str


class UserProfile(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: str = Field(alias="userId")
    username: str
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")
    friends: List[str] = Field(default_factory=list)
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")


class AuthTokenResponse(BaseModel):
    token: str
    profile: UserProfile


class UserProfilePatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    username: Optional[str] = Field(default=None, min_length=3, max_length=32)
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")
    friends: Optional[List[str]] = None


__all__ = [
    "UserSignupRequest",
    "UserLoginRequest",
    "UserProfile",
    "AuthTokenResponse",
    "UserProfilePatch",
]
