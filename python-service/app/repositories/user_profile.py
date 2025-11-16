"""Repository helpers for the user profile MongoDB database."""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db.collections import USER_PROFILES_COLLECTION
from ..models.user_profile import UserProfileDocument
from .exceptions import DuplicateKeyRepositoryError, NotFoundRepositoryError

LOGGER = logging.getLogger("uvicorn.error")


class UserProfileRepository:
    """Thin abstraction over the user profile MongoDB collection."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        self._database = database
        self._collection: AsyncIOMotorCollection = database[USER_PROFILES_COLLECTION]

    @property
    def collection(self) -> AsyncIOMotorCollection:
        return self._collection

    async def create_profile(
        self,
        *,
        user_id: str,
        username: str,
        password_hash: str,
        created_at: int,
        updated_at: int,
        avatar_url: Optional[str] = None,
        friends: Optional[Iterable[str]] = None,
    ) -> UserProfileDocument:
        """Insert a new user profile document."""

        doc = {
            "_id": ObjectId(),
            "userId": user_id,
            "username": username,
            "usernameLower": username.lower(),
            "passwordHash": password_hash,
            "avatarUrl": avatar_url,
            "friends": list(friends or []),
            "createdAt": created_at,
            "updatedAt": updated_at,
        }
        try:
            await self._collection.insert_one(doc)
        except DuplicateKeyError as exc:  # pragma: no cover - exercised via service layer tests
            LOGGER.debug("Duplicate user profile insertion for username=%s", username)
            raise DuplicateKeyRepositoryError("username already exists") from exc
        return UserProfileDocument(**doc)

    async def get_by_username(self, username: str) -> Optional[UserProfileDocument]:
        doc = await self._collection.find_one({"usernameLower": username.lower()})
        return UserProfileDocument(**doc) if doc else None

    async def get_by_user_id(self, user_id: str) -> Optional[UserProfileDocument]:
        doc = await self._collection.find_one({"userId": user_id})
        return UserProfileDocument(**doc) if doc else None

    async def get_by_object_id(self, object_id: ObjectId) -> Optional[UserProfileDocument]:
        doc = await self._collection.find_one({"_id": object_id})
        return UserProfileDocument(**doc) if doc else None

    async def update_profile(
        self,
        *,
        user_id: str,
        updates: dict,
    ) -> UserProfileDocument:
        """Update a profile identified by its userId."""

        result = await self._collection.find_one_and_update(
            {"userId": user_id},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )
        if not result:
            raise NotFoundRepositoryError("user profile not found")
        return UserProfileDocument(**result)

    async def username_exists(
        self,
        username: str,
        *,
        exclude_user_id: Optional[str] = None,
    ) -> bool:
        query: dict[str, object] = {"usernameLower": username.lower()}
        if exclude_user_id:
            query["userId"] = {"$ne": exclude_user_id}
        doc = await self._collection.find_one(query, projection={"_id": 1})
        return doc is not None


__all__ = ["UserProfileRepository"]
