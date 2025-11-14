from datetime import datetime
from typing import List, Tuple

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from ..db.mongo import get_likes_collection
from ..models.likes import LikedUser


async def is_reverse_like_exists(
    db: AsyncIOMotorDatabase, liker_id: str, liked_id: str
) -> bool:
    collection = get_likes_collection(db)
    reverse_like = await collection.find_one(
        {"liker_id": liker_id, "liked_id": liked_id},
        projection={"_id": 1},
    )
    return reverse_like is not None


async def check_match(
    db: AsyncIOMotorDatabase, user_a: str, user_b: str
) -> bool:
    if user_a == user_b:
        return False
    collection = get_likes_collection(db)
    count = await collection.count_documents(
        {
            "$or": [
                {"liker_id": user_a, "liked_id": user_b},
                {"liker_id": user_b, "liked_id": user_a},
            ]
        },
        limit=2,
    )
    return count == 2


async def record_like(
    db: AsyncIOMotorDatabase, liker_id: str, liked_id: str
) -> Tuple[bool, bool]:
    if liker_id == liked_id:
        raise ValueError("Users cannot like themselves")

    collection = get_likes_collection(db)
    created_at = datetime.utcnow()
    is_new_like = False

    try:
        result = await collection.update_one(
            {"liker_id": liker_id, "liked_id": liked_id},
            {
                "$setOnInsert": {
                    "liker_id": liker_id,
                    "liked_id": liked_id,
                    "created_at": created_at,
                }
            },
            upsert=True,
        )
        is_new_like = result.upserted_id is not None
    except DuplicateKeyError:
        # Treat duplicate as success; the unique index guarantees idempotency
        pass

    is_match = await is_reverse_like_exists(db, liked_id, liker_id)
    return is_new_like, is_match


async def remove_like(
    db: AsyncIOMotorDatabase, liker_id: str, liked_id: str
) -> bool:
    if liker_id == liked_id:
        return False
    collection = get_likes_collection(db)
    result = await collection.delete_one({"liker_id": liker_id, "liked_id": liked_id})
    return bool(result.deleted_count)


async def get_likes_received(
    db: AsyncIOMotorDatabase, user_id: str
) -> List[LikedUser]:
    collection = get_likes_collection(db)
    pipeline = [
        {"$match": {"liked_id": user_id}},
        {
            "$lookup": {
                "from": collection.name,
                "let": {"other": "$liker_id", "self": "$liked_id"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$liker_id", "$$self"]},
                                    {"$eq": ["$liked_id", "$$other"]},
                                ]
                            }
                        }
                    },
                    {"$limit": 1},
                ],
                "as": "reverse",
            }
        },
        {"$match": {"reverse": {"$eq": []}}},
        {
            "$lookup": {
                "from": "profiles",
                "localField": "liker_id",
                "foreignField": "userId",
                "as": "profile",
            }
        },
        {"$unwind": {"path": "$profile", "preserveNullAndEmptyArrays": True}},
        {"$addFields": {"liked_at": {"$toLong": "$created_at"}}},
        {
            "$project": {
                "user_id": "$liker_id",
                "username": "$profile.username",
                "name": {
                    "$ifNull": ["$profile.displayName", "$profile.username"]
                },
                "avatar": "$profile.avatarUrl",
                "liked_at": 1,
            }
        },
        {"$sort": {"liked_at": -1}},
    ]
    rows = await collection.aggregate(pipeline).to_list(length=None)
    return [
        LikedUser(
            user_id=row.get("user_id"),
            username=row.get("username"),
            name=row.get("name"),
            avatar=row.get("avatar"),
            liked_at=row.get("liked_at"),
        )
        for row in rows
    ]


async def get_matches(
    db: AsyncIOMotorDatabase, user_id: str
) -> List[LikedUser]:
    collection = get_likes_collection(db)
    pipeline = [
        {"$match": {"liker_id": user_id}},
        {
            "$lookup": {
                "from": collection.name,
                "let": {"other": "$liked_id", "self": "$liker_id"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$liker_id", "$$other"]},
                                    {"$eq": ["$liked_id", "$$self"]},
                                ]
                            }
                        }
                    },
                    {"$limit": 1},
                ],
                "as": "reverse",
            }
        },
        {"$match": {"reverse": {"$ne": []}}},
        {
            "$lookup": {
                "from": "profiles",
                "localField": "liked_id",
                "foreignField": "userId",
                "as": "profile",
            }
        },
        {"$unwind": {"path": "$profile", "preserveNullAndEmptyArrays": True}},
        {
            "$addFields": {
                "liked_at": {"$toLong": "$created_at"},
                "reverse_like": {"$arrayElemAt": ["$reverse", 0]},
            }
        },
        {
            "$addFields": {
                "reverse_liked_at": {
                    "$cond": [
                        {"$ifNull": ["$reverse_like.created_at", False]},
                        {"$toLong": "$reverse_like.created_at"},
                        None,
                    ]
                }
            }
        },
        {
            "$addFields": {
                "matched_at": {
                    "$cond": [
                        {
                            "$and": [
                                {"$ne": ["$liked_at", None]},
                                {"$ne": ["$reverse_liked_at", None]},
                            ]
                        },
                        {"$max": ["$liked_at", "$reverse_liked_at"]},
                        {"$ifNull": ["$liked_at", "$reverse_liked_at"]},
                    ]
                }
            }
        },
        {
            "$project": {
                "user_id": "$liked_id",
                "username": "$profile.username",
                "name": {
                    "$ifNull": ["$profile.displayName", "$profile.username"]
                },
                "avatar": "$profile.avatarUrl",
                "liked_at": 1,
                "matched_at": 1,
            }
        },
        {"$sort": {"matched_at": -1, "liked_at": -1}},
    ]
    rows = await collection.aggregate(pipeline).to_list(length=None)
    return [
        LikedUser(
            user_id=row.get("user_id"),
            username=row.get("username"),
            name=row.get("name"),
            avatar=row.get("avatar"),
            liked_at=row.get("liked_at"),
            matched_at=row.get("matched_at"),
        )
        for row in rows
    ]


__all__ = [
    "record_like",
    "remove_like",
    "get_likes_received",
    "get_matches",
    "is_reverse_like_exists",
    "check_match",
]
