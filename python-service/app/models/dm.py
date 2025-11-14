from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .message import MessageBase, MessageCreateRequest, MessageEditRequest, MessageReactionRequest


class DmMessage(MessageBase):
    dm_id: str = Field(..., alias="dmId")


class DmMessageList(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    messages: List[DmMessage] = Field(..., alias="messages")


class DmThreadsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    threads: List[Dict[str, Any]]


__all__ = [
    "DmMessage",
    "DmMessageList",
    "DmThreadsResponse",
    "MessageCreateRequest",
    "MessageEditRequest",
    "MessageReactionRequest",
]
