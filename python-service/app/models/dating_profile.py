from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class DatingProfile(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    user_id: str = Field(alias="userId")
    username: Optional[str] = None
    display_name: Optional[str] = Field(default=None, alias="displayName")
    primary_photo_url: Optional[str] = Field(default=None, alias="primaryPhotoUrl")
    photos: List[str] = Field(default_factory=list)
    is_active: bool = Field(default=False, alias="isActive")
    bio: Optional[str] = None
    updated_at: Optional[int] = Field(default=None, alias="updatedAt")


__all__ = ["DatingProfile"]
