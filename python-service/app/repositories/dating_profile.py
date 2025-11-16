"""Repository helpers for dating profile persistence."""

from __future__ import annotations

import logging
from typing import Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from ..db.collections import DATING_PROFILES_COLLECTION
from ..models.dating_profile import DatingProfileDocument
from .exceptions import NotFoundRepositoryError

LOGGER = logging.getLogger("uvicorn.error")


class DatingProfileRepository:
    """MongoDB access layer for dating profile documents."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        self._database = database
        self._collection: AsyncIOMotorCollection = database[DATING_PROFILES_COLLECTION]

    @property
    def collection(self) -> AsyncIOMotorCollection:
        return self._collection

    async def get_by_user_profile_id(
        self, user_profile_id: ObjectId
    ) -> Optional[DatingProfileDocument]:
        doc = await self._collection.find_one({"userProfileId": user_profile_id})
        return DatingProfileDocument(**doc) if doc else None

    async def get_by_user_id(self, user_id: str) -> Optional[DatingProfileDocument]:
        doc = await self._collection.find_one({"userId": user_id})
        return DatingProfileDocument(**doc) if doc else None

    async def upsert_profile(
        self,
        *,
        user_profile_id: ObjectId,
        user_id: str,
        updates: dict[str, Any],
        updated_at: int,
        created_at: int,
    ) -> DatingProfileDocument:
        """Create or update a dating profile for the given user."""

        doc = await self._collection.find_one_and_update(
            {"userProfileId": user_profile_id},
            {
                "$set": {
                    **updates,
                    "userId": user_id,
                    "updatedAt": updated_at,
                },
                "$setOnInsert": {
                    "_id": ObjectId(),
                    "userProfileId": user_profile_id,
                    "createdAt": created_at,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if not doc:  # pragma: no cover - defensive, Motor should return doc on upsert
            raise NotFoundRepositoryError("dating profile upsert failed")
        return DatingProfileDocument(**doc)

    async def delete_by_user_profile_id(self, user_profile_id: ObjectId) -> bool:
        result = await self._collection.delete_one({"userProfileId": user_profile_id})
        return bool(result.deleted_count)


__all__ = ["DatingProfileRepository"]
