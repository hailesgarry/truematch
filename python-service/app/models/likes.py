from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

class LikeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_user_id: str = Field(alias="target_user_id", min_length=1)

class LikeResponse(BaseModel):
    status: Literal["ok"] = "ok"
    is_match: bool

class LikedUser(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: str = Field(alias="user_id")
    username: Optional[str] = None
    name: Optional[str] = None
    avatar: Optional[str] = None
    profile_avatar: Optional[str] = Field(default=None, alias="profile_avatar")
    dating_photo: Optional[str] = Field(default=None, alias="dating_photo")
    dating_photos: Optional[List[str]] = Field(default=None, alias="dating_photos")
    has_dating_profile: Optional[bool] = Field(default=None, alias="has_dating_profile")
    liked_at: Optional[int] = Field(default=None, alias="liked_at")
    matched_at: Optional[int] = Field(default=None, alias="matched_at")

class LikesReceivedResponse(BaseModel):
    liked_me: List[LikedUser] = Field(default_factory=list)

class MatchesResponse(BaseModel):
    matches: List[LikedUser] = Field(default_factory=list)

class LikeRemovalResponse(BaseModel):
    status: Literal["ok"] = "ok"
    removed: bool = False

__all__ = [
    "LikeRequest",
    "LikeResponse",
    "LikedUser",
    "LikesReceivedResponse",
    "MatchesResponse",
    "LikeRemovalResponse",
]
