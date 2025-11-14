from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ReactionSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    total_count: int = Field(0, alias="totalCount")
    most_recent: Optional[Dict[str, Any]] = Field(None, alias="mostRecent")


class MessageBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    message_id: Optional[str] = Field(None, alias="messageId")
    group_id: Optional[str] = Field(None, alias="groupId")
    dm_id: Optional[str] = Field(None, alias="dmId")
    room_id: Optional[str] = Field(None, alias="roomId")
    user_id: Optional[str] = Field(None, alias="userId")
    username: Optional[str] = None
    avatar: Optional[str] = None
    bubble_color: Optional[str] = Field(None, alias="bubbleColor")
    text: Optional[str] = None
    kind: Optional[str] = None
    created_at: Optional[int] = Field(None, alias="createdAt")
    timestamp: Optional[str] = None
    reactions: Dict[str, Any] = Field(default_factory=dict)


class MessageCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    user_id: str = Field(..., alias="userId")
    username: str
    text: Optional[str] = None
    bubble_color: Optional[str] = Field(None, alias="bubbleColor")
    kind: Optional[str] = None
    media: Optional[Dict[str, Any]] = None
    audio: Optional[Dict[str, Any]] = None
    reply_to: Optional[Dict[str, Any]] = Field(None, alias="replyTo")
    reply_to_message_id: Optional[str] = Field(None, alias="replyToMessageId")
    reply_to_timestamp: Optional[str] = Field(None, alias="replyToTimestamp")


class MessageEditRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    new_text: str = Field(..., alias="newText")


class MessageReactionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    emoji: Optional[str] = None
    user: Dict[str, Any]


class MessageListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    items: List[MessageBase]


__all__ = [
    "ReactionSummary",
    "MessageBase",
    "MessageCreateRequest",
    "MessageEditRequest",
    "MessageReactionRequest",
    "MessageListResponse",
]
