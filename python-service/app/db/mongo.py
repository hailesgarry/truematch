from typing import Final
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

LIKES_COLLECTION: Final[str] = "likes"

async def ensure_likes_indexes(db: AsyncIOMotorDatabase) -> None:
    collection = db[LIKES_COLLECTION]
    await collection.create_index(
        [("liker_id", ASCENDING), ("liked_id", ASCENDING)],
        name="likes_liker_liked_unique",
        unique=True,
    )
    await collection.create_index(
        [("liked_id", ASCENDING), ("created_at", DESCENDING)],
        name="likes_liked_id_idx",
    )
    await collection.create_index(
        [("liker_id", ASCENDING), ("created_at", DESCENDING)],
        name="likes_liker_id_idx",
    )

def get_likes_collection(db: AsyncIOMotorDatabase):
    return db[LIKES_COLLECTION]

__all__ = ["LIKES_COLLECTION", "ensure_likes_indexes", "get_likes_collection"]
