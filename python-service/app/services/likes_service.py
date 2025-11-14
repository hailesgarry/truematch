from datetime import datetime
from typing import Any, List, Optional, Tuple

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from ..db.mongo import get_likes_collection
from ..models.likes import LikedUser
from ..services.dating_profile_service import resolve_primary_photo


def _clean_str(value: Any) -> Optional[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def _clean_photo_list(value: Any, limit: int = 12) -> List[str]:
    photos: List[str] = []
    if isinstance(value, (list, tuple, set)):
        for entry in value:
            cleaned = _clean_str(entry)
            if not cleaned:
                continue
            if cleaned in photos:
                continue
            photos.append(cleaned)
            if len(photos) >= limit:
                break
    return photos


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
        {
            "$lookup": {
                "from": "dating_profiles",
                "localField": "liker_id",
                "foreignField": "userId",
                "as": "dating_profile",
            }
        },
        {"$unwind": {"path": "$dating_profile", "preserveNullAndEmptyArrays": True}},
        {
            "$addFields": {
                "liked_at": {"$toLong": "$created_at"},
                "dating_profile_photos": {
                    "$cond": [
                        {"$isArray": "$dating_profile.photos"},
                        "$dating_profile.photos",
                        [],
                    ]
                },
                "legacy_profile_photos": {
                    "$cond": [
                        {"$isArray": "$profile.photos"},
                        "$profile.photos",
                        [],
                    ]
                },
                "legacy_primary_photo": {
                    "$ifNull": [
                        "$profile.primaryPhotoUrl",
                        {"$ifNull": ["$profile.photoUrl", "$profile.photo"]},
                    ]
                },
            }
        },
        {
            "$project": {
                "user_id": "$liker_id",
                "username": "$profile.username",
                "name": {
                    "$ifNull": ["$profile.displayName", "$profile.username"]
                },
                "avatar": "$profile.avatarUrl",
                "profile_avatar": "$profile.avatarUrl",
                "dating_photo": {
                    "$ifNull": [
                        "$dating_profile.primaryPhotoUrl",
                        {
                            "$ifNull": [
                                {"$arrayElemAt": ["$dating_profile_photos", 0]},
                                {
                                    "$ifNull": [
                                        "$legacy_primary_photo",
                                        {"$arrayElemAt": ["$legacy_profile_photos", 0]},
                                    ]
                                },
                            ]
                        },
                    ]
                },
                "dating_photos": {
                    "$cond": [
                        {"$gt": [{"$size": "$dating_profile_photos"}, 0]},
                        "$dating_profile_photos",
                        "$legacy_profile_photos",
                    ]
                },
                "has_dating_profile": {
                    "$cond": [
                        {
                            "$or": [
                                {"$eq": ["$dating_profile.isActive", True]},
                                {"$ifNull": ["$dating_profile.primaryPhotoUrl", False]},
                                {"$gt": [{"$size": "$dating_profile_photos"}, 0]},
                            ]
                        },
                        True,
                        False,
                    ]
                },
                "liked_at": 1,
            }
        },
        {"$sort": {"liked_at": -1}},
    ]
    rows = await collection.aggregate(pipeline).to_list(length=None)

    results: List[LikedUser] = []
    for row in rows:
        user_id = row.get("user_id")
        if isinstance(user_id, str):
            user_id = user_id.strip()

        username = _clean_str(row.get("username")) or row.get("username")
        name = _clean_str(row.get("name")) or row.get("name")

        profile_avatar = _clean_str(row.get("profile_avatar") or row.get("avatar"))
        dating_photos = _clean_photo_list(row.get("dating_photos"))
        dating_photo = _clean_str(row.get("dating_photo"))
        if not dating_photo:
            dating_photo = resolve_primary_photo(
                {
                    "primaryPhotoUrl": row.get("dating_photo"),
                    "photos": dating_photos,
                }
            )
        if not dating_photo and dating_photos:
            dating_photo = dating_photos[0]

        liked_user = LikedUser(
            user_id=user_id,
            username=username,
            name=name,
            avatar=profile_avatar,
            profile_avatar=profile_avatar,
            dating_photo=dating_photo,
            dating_photos=dating_photos or None,
            has_dating_profile=bool(row.get("has_dating_profile")),
            liked_at=row.get("liked_at"),
        )
        results.append(liked_user)

    return results


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
            "$lookup": {
                "from": "dating_profiles",
                "localField": "liked_id",
                "foreignField": "userId",
                "as": "dating_profile",
            }
        },
        {"$unwind": {"path": "$dating_profile", "preserveNullAndEmptyArrays": True}},
        {
            "$addFields": {
                "liked_at": {"$toLong": "$created_at"},
                "reverse_like": {"$arrayElemAt": ["$reverse", 0]},
                "dating_profile_photos": {
                    "$cond": [
                        {"$isArray": "$dating_profile.photos"},
                        "$dating_profile.photos",
                        [],
                    ]
                },
                "legacy_profile_photos": {
                    "$cond": [
                        {"$isArray": "$profile.photos"},
                        "$profile.photos",
                        [],
                    ]
                },
                "legacy_primary_photo": {
                    "$ifNull": [
                        "$profile.primaryPhotoUrl",
                        {"$ifNull": ["$profile.photoUrl", "$profile.photo"]},
                    ]
                },
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
                "profile_avatar": "$profile.avatarUrl",
                "dating_photo": {
                    "$ifNull": [
                        "$dating_profile.primaryPhotoUrl",
                        {
                            "$ifNull": [
                                {"$arrayElemAt": ["$dating_profile_photos", 0]},
                                {
                                    "$ifNull": [
                                        "$legacy_primary_photo",
                                        {"$arrayElemAt": ["$legacy_profile_photos", 0]},
                                    ]
                                },
                            ]
                        },
                    ]
                },
                "dating_photos": {
                    "$cond": [
                        {"$gt": [{"$size": "$dating_profile_photos"}, 0]},
                        "$dating_profile_photos",
                        "$legacy_profile_photos",
                    ]
                },
                "has_dating_profile": {
                    "$cond": [
                        {
                            "$or": [
                                {"$eq": ["$dating_profile.isActive", True]},
                                {"$ifNull": ["$dating_profile.primaryPhotoUrl", False]},
                                {"$gt": [{"$size": "$dating_profile_photos"}, 0]},
                            ]
                        },
                        True,
                        False,
                    ]
                },
                "liked_at": 1,
                "matched_at": 1,
            }
        },
        {"$sort": {"matched_at": -1, "liked_at": -1}},
    ]
    rows = await collection.aggregate(pipeline).to_list(length=None)

    results: List[LikedUser] = []
    for row in rows:
        user_id = row.get("user_id")
        if isinstance(user_id, str):
            user_id = user_id.strip()

        username = _clean_str(row.get("username")) or row.get("username")
        name = _clean_str(row.get("name")) or row.get("name")

        profile_avatar = _clean_str(row.get("profile_avatar") or row.get("avatar"))
        dating_photos = _clean_photo_list(row.get("dating_photos"))
        dating_photo = _clean_str(row.get("dating_photo"))
        if not dating_photo:
            dating_photo = resolve_primary_photo(
                {
                    "primaryPhotoUrl": row.get("dating_photo"),
                    "photos": dating_photos,
                }
            )
        if not dating_photo and dating_photos:
            dating_photo = dating_photos[0]

        liked_user = LikedUser(
            user_id=user_id,
            username=username,
            name=name,
            avatar=profile_avatar,
            profile_avatar=profile_avatar,
            dating_photo=dating_photo,
            dating_photos=dating_photos or None,
            has_dating_profile=bool(row.get("has_dating_profile")),
            liked_at=row.get("liked_at"),
            matched_at=row.get("matched_at"),
        )
        results.append(liked_user)

    return results 


__all__ = [
    "record_like",
    "remove_like",
    "get_likes_received",
    "get_matches",
    "is_reverse_like_exists",
    "check_match",
]
 