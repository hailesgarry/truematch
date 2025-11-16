from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .identifiers import PyObjectId


class DatingProfileDocument(BaseModel):
    """Canonical dating profile document stored in MongoDB."""

    model_config = ConfigDict(populate_by_name=True, extra="allow", arbitrary_types_allowed=True)

    id: PyObjectId = Field(alias="_id")
    user_profile_id: PyObjectId = Field(alias="userProfileId")
    user_id: str = Field(alias="userId")
    first_name: Optional[str] = Field(default=None, alias="firstName")
    primary_photo_url: Optional[str] = Field(default=None, alias="primaryPhotoUrl")
    photos: List[str] = Field(default_factory=list)
    is_active: bool = Field(default=False, alias="isActive")
    bio: Optional[str] = None
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")


class DatingProfile(BaseModel):
    """Public representation of a dating profile returned via the API."""

    model_config = ConfigDict(populate_by_name=True, extra="allow", arbitrary_types_allowed=True)

    id: PyObjectId = Field(alias="_id")
    user_profile_id: PyObjectId = Field(alias="userProfileId")
    user_id: str = Field(alias="userId")
    first_name: Optional[str] = Field(default=None, alias="firstName")
    primary_photo_url: Optional[str] = Field(default=None, alias="primaryPhotoUrl")
    photos: List[str] = Field(default_factory=list)
    is_active: bool = Field(default=False, alias="isActive")
    bio: Optional[str] = None
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")


class DatingProfileUpsert(BaseModel):
    """Payload accepted when creating or updating a dating profile."""

    model_config = ConfigDict(populate_by_name=True, extra="allow", arbitrary_types_allowed=True)

    first_name: Optional[str] = Field(default=None, alias="firstName")
    primary_photo_url: Optional[str] = Field(default=None, alias="primaryPhotoUrl")
    photos: List[str] = Field(default_factory=list)
    is_active: Optional[bool] = Field(default=None, alias="isActive")
    bio: Optional[str] = None


class DatingProfileCreateRequest(DatingProfileUpsert):
    """Request model for creating a dating profile."""

    user_id: str = Field(alias="userId", min_length=1)


__all__ = [
    "DatingProfile",
    "DatingProfileDocument",
    "DatingProfileUpsert",
    "DatingProfileCreateRequest",
]
