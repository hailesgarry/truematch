from typing import List, Literal, Optional
from pydantic import BaseModel, Field

class LikeRequest(BaseModel):
    target_user_id: str = Field(alias="target_user_id", min_length=1)

    class Config:
        allow_population_by_field_name = True

class LikeResponse(BaseModel):
    status: Literal["ok"] = "ok"
    is_match: bool

class LikedUser(BaseModel):
    user_id: str = Field(alias="user_id")
    username: Optional[str] = None
    name: Optional[str] = None
    avatar: Optional[str] = None
    liked_at: Optional[int] = Field(default=None, alias="liked_at")
    matched_at: Optional[int] = Field(default=None, alias="matched_at")

    class Config:
        allow_population_by_field_name = True

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
