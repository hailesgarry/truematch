from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class Group(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = Field(None, alias="avatarUrl")
    member_count: Optional[int] = Field(None, alias="memberCount")
    online_count: Optional[int] = Field(None, alias="onlineCount")


class GroupMemberPreview(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    username: str
    avatar: Optional[str] = None
    user_id: Optional[str] = Field(None, alias="userId")


class GroupRosterPreview(BaseModel):
    model_config = ConfigDict(extra="allow")

    total: int
    members: List[GroupMemberPreview]


class GroupRosterResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    groups: Dict[str, GroupRosterPreview]


class GroupCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    name: str
    description: Optional[str] = None
    avatar_url: Optional[str] = Field(None, alias="avatarUrl")


class GroupUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    name: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = Field(None, alias="avatarUrl")


__all__ = [
    "Group",
    "GroupMemberPreview",
    "GroupRosterPreview",
    "GroupRosterResponse",
    "GroupCreateRequest",
    "GroupUpdateRequest",
]
