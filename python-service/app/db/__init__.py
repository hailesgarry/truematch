import logging
import os
from typing import Optional 

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase 

from ..config import get_settings
from .collections import (
    DATING_PROFILES_COLLECTION,
    LEGACY_DATING_PROFILES_COLLECTIONS,
    USER_PROFILES_COLLECTION,
)
from .mongo import ensure_likes_indexes

_client: Optional[AsyncIOMotorClient] = None
_core_db: Optional[AsyncIOMotorDatabase] = None
_user_db: Optional[AsyncIOMotorDatabase] = None
_dating_db: Optional[AsyncIOMotorDatabase] = None


async def _ensure_user_indexes(db: AsyncIOMotorDatabase) -> None:
    logger = logging.getLogger("uvicorn.error")
    try:
        await db[USER_PROFILES_COLLECTION].create_index("usernameLower", unique=True)
        await db[USER_PROFILES_COLLECTION].create_index("userId", unique=True)
        await db[USER_PROFILES_COLLECTION].create_index("createdAt")
    except Exception as exc:  # pragma: no cover - best-effort logging
        logger.error("Failed to ensure user profile indexes: %s", exc)


async def _ensure_dating_indexes(db: AsyncIOMotorDatabase) -> None:
    logger = logging.getLogger("uvicorn.error")
    try:
        await db[DATING_PROFILES_COLLECTION].create_index(
            "userProfileId",
            unique=True,
            sparse=True,
        )
        await db[DATING_PROFILES_COLLECTION].create_index(
            "userId",
            unique=True,
            sparse=True,
        )
        await db[DATING_PROFILES_COLLECTION].create_index("updatedAt")
    except Exception as exc:  # pragma: no cover - best-effort logging
        logger.error("Failed to ensure dating profile indexes: %s", exc)


async def _migrate_legacy_dating_profiles(
    source_db: AsyncIOMotorDatabase,
    target_db: AsyncIOMotorDatabase,
) -> None:
    if source_db is None or target_db is None:
        return

    target_name = DATING_PROFILES_COLLECTION
    legacy_names = LEGACY_DATING_PROFILES_COLLECTIONS
    logger = logging.getLogger("uvicorn.error")

    try:
        source_collections = await source_db.list_collection_names()
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to list collections for migration: %s", exc)
        return

    legacy_candidates = [
        name for name in legacy_names if name in source_collections and name != target_name
    ]

    if not legacy_candidates:
        return

    target_collection = target_db[target_name]

    for legacy_name in legacy_candidates:
        legacy_collection = source_db[legacy_name]
        migrated = 0
        try:
            async for document in legacy_collection.find({}):
                if "_id" not in document or "userProfileId" not in document:
                    continue
                await target_collection.replace_one(
                    {"_id": document["_id"]},
                    document,
                    upsert=True,
                )
                migrated += 1
        except Exception as exc:  # pragma: no cover - best-effort logging
            logger.error(
                "Failed migrating legacy dating profiles from '%s': %s",
                legacy_name,
                exc,
            )
            continue

        try:
            await legacy_collection.drop()
            logger.info(
                "Migrated %s legacy dating profiles from '%s' into '%s' and dropped legacy collection",
                migrated,
                legacy_name,
                target_name,
            )
        except Exception as exc:  # pragma: no cover - best-effort logging
            logger.error(
                "Failed to drop legacy dating profiles collection '%s': %s",
                legacy_name,
                exc,
            )


async def _ensure_core_indexes(db: AsyncIOMotorDatabase) -> None:
    logger = logging.getLogger("uvicorn.error")
    try:
        await ensure_likes_indexes(db)
    except Exception as exc:  # pragma: no cover - best-effort logging
        logger.error("Failed to ensure likes indexes: %s", exc)


async def _sanitize_dating_profiles(
    dating_db: Optional[AsyncIOMotorDatabase],
    user_db: Optional[AsyncIOMotorDatabase],
) -> None:
    if dating_db is None or user_db is None:
        return

    logger = logging.getLogger("uvicorn.error")
    collection = dating_db[DATING_PROFILES_COLLECTION]
    legacy_fields = ("username", "usernameLower", "displayName", "name", "photo", "photoUrl", "hasDatingProfile")
    query = {
        "$or": [
            {"firstName": {"$exists": False}},
            {"firstName": None},
            {"firstName": ""},
            {"primaryPhotoUrl": {"$exists": False}},
            *[{field: {"$exists": True}} for field in legacy_fields],
        ]
    }

    projection = {
        "_id": 1,
        "userId": 1,
        "userProfileId": 1,
        "firstName": 1,
        "displayName": 1,
        "name": 1,
        "username": 1,
        "photo": 1,
        "photoUrl": 1,
        "primaryPhotoUrl": 1,
        "photos": 1,
        "hasDatingProfile": 1,
    }

    try:
        cursor = collection.find(query, projection=projection)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to query dating profiles for sanitization: %s", exc)
        return

    users_with_profiles: set[str] = set()
    users_without_profiles: set[str] = set()

    async for document in cursor:
        set_ops: dict[str, object] = {}
        unset_ops: dict[str, str] = {}

        raw_user_id = document.get("userId")
        user_id = raw_user_id.strip() if isinstance(raw_user_id, str) else ""
        should_delete = not user_id

        if any(field in document for field in legacy_fields):
            should_delete = True

        if should_delete:
            try:
                await collection.delete_one({"_id": document["_id"]})
                if user_id:
                    users_without_profiles.add(user_id)
            except Exception as exc:  # pragma: no cover - best-effort logging
                logger.error("Failed to delete legacy dating profile %s: %s", document.get("_id"), exc)
            continue

        first_name = document.get("firstName")
        if not isinstance(first_name, str) or not first_name.strip():
            for candidate_key in ("displayName", "name", "username"):
                candidate_val = document.get(candidate_key)
                if isinstance(candidate_val, str) and candidate_val.strip():
                    first_name = candidate_val.strip()
                    break
            else:
                first_name = None
        if first_name:
            set_ops["firstName"] = first_name

        primary_photo = document.get("primaryPhotoUrl")
        if not isinstance(primary_photo, str) or not primary_photo.strip():
            for photo_key in ("photo", "photoUrl"):
                candidate_photo = document.get(photo_key)
                if isinstance(candidate_photo, str) and candidate_photo.strip():
                    primary_photo = candidate_photo.strip()
                    break
            else:
                primary_photo = None
            if not primary_photo:
                photos = document.get("photos")
                if isinstance(photos, list):
                    primary_photo = next(
                        (p.strip() for p in photos if isinstance(p, str) and p.strip()),
                        None,
                    )
        if primary_photo:
            set_ops["primaryPhotoUrl"] = primary_photo

        for field in legacy_fields:
            if field in document:
                unset_ops[field] = ""

        update_doc: dict[str, object] = {}
        if set_ops:
            update_doc["$set"] = set_ops
        if unset_ops:
            update_doc["$unset"] = unset_ops

        if update_doc:
            try:
                await collection.update_one({"_id": document["_id"]}, update_doc)
            except Exception as exc:  # pragma: no cover - best-effort logging
                logger.error("Failed to sanitize dating profile %s: %s", document.get("_id"), exc)

        users_with_profiles.add(user_id)

    if users_with_profiles or users_without_profiles:
        user_collection = user_db[USER_PROFILES_COLLECTION]
        try:
            if users_with_profiles:
                await user_collection.update_many(
                    {"userId": {"$in": list(users_with_profiles)}},
                    {"$set": {"hasDatingProfile": True}},
                )
            users_to_clear = users_without_profiles.difference(users_with_profiles)
            if users_to_clear:
                await user_collection.update_many(
                    {"userId": {"$in": list(users_to_clear)}, "hasDatingProfile": {"$exists": True}},
                    {"$unset": {"hasDatingProfile": ""}},
                )
        except Exception as exc:  # pragma: no cover - best-effort logging
            logger.error("Failed to synchronize hasDatingProfile flag: %s", exc)


async def connect_to_mongo() -> None:
    """Initialise the shared MongoDB client and scoped databases."""

    global _client, _core_db, _user_db, _dating_db

    settings = get_settings()
    if not settings.mongo_uri and not getattr(settings, "mongo_alt_uri", None):
        raise RuntimeError("Missing MONGO_URI env var for python-service")

    logger = logging.getLogger("uvicorn.error")
    sel_timeout_ms = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "3000"))
    conn_timeout_ms = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "3000"))
    sock_timeout_ms = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "5000"))

    async def _try_connect(uri: str) -> tuple[
        AsyncIOMotorClient,
        AsyncIOMotorDatabase,
        AsyncIOMotorDatabase,
        AsyncIOMotorDatabase,
    ]:
        client = AsyncIOMotorClient(
            uri,
            maxPoolSize=20,
            serverSelectionTimeoutMS=sel_timeout_ms,
            connectTimeoutMS=conn_timeout_ms,
            socketTimeoutMS=sock_timeout_ms,
            **({"directConnection": True} if getattr(settings, "mongo_direct", False) else {}),
        )
        core_db = client[settings.mongo_db]
        user_db = client[settings.mongo_user_db]
        dating_db = client[settings.mongo_dating_db]

        await client.admin.command("ping")
        await _ensure_core_indexes(core_db)
        await _ensure_user_indexes(user_db)
        await _migrate_legacy_dating_profiles(core_db, dating_db)
        await _ensure_dating_indexes(dating_db)
        await _sanitize_dating_profiles(dating_db, user_db)

        return client, core_db, user_db, dating_db

    primary_error: Optional[Exception] = None

    try:
        _client, _core_db, _user_db, _dating_db = await _try_connect(settings.mongo_uri)
        addr = getattr(_client, "address", None)
        if addr:
            logger.info(
                "MongoDB connected: core_db=%s, primary=%s:%s",
                settings.mongo_db,
                addr[0],
                addr[1],
            )
        else:
            logger.info("MongoDB connected: core_db=%s", settings.mongo_db)
        return
    except Exception as exc:  # pragma: no cover - connection issues asserted in tests
        primary_error = exc
        logger.error("Mongo primary URI failed: %s", exc)

    alt_uri = getattr(settings, "mongo_alt_uri", None)
    if alt_uri:
        try:
            _client, _core_db, _user_db, _dating_db = await _try_connect(alt_uri)
            addr = getattr(_client, "address", None)
            if addr:
                logger.info(
                    "MongoDB connected via ALT URI: core_db=%s, primary=%s:%s",
                    settings.mongo_db,
                    addr[0],
                    addr[1],
                )
            else:
                logger.info("MongoDB connected via ALT URI: core_db=%s", settings.mongo_db)
            return
        except Exception as exc:  # pragma: no cover - same as above
            logger.error("Mongo ALT URI failed: %s", exc)

    raise primary_error or RuntimeError("Mongo connection failed")


async def close_mongo_connection() -> None:
    """Close the MongoDB client if it is initialised."""

    global _client
    if _client:
        try:
            _client.close()
        finally:
            logging.getLogger("uvicorn.error").info("MongoDB connection closed")
        _client = None


def _require_database(db: Optional[AsyncIOMotorDatabase], label: str) -> AsyncIOMotorDatabase:
    if db is None:
        raise RuntimeError(f"MongoDB database '{label}' not connected. Did you call connect_to_mongo()?")
    return db


def get_db() -> AsyncIOMotorDatabase:
    """Backward compatible accessor for the core application database."""

    return get_core_db()


def get_core_db() -> AsyncIOMotorDatabase:
    return _require_database(_core_db, "core")


def get_user_db() -> AsyncIOMotorDatabase:
    return _require_database(_user_db, "user-profile")


def get_dating_db() -> AsyncIOMotorDatabase:
    return _require_database(_dating_db, "dating")


def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("Mongo client not initialised. Did you call connect_to_mongo()?")
    return _client


__all__ = [
    "connect_to_mongo",
    "close_mongo_connection",
    "get_db",
    "get_core_db",
    "get_user_db",
    "get_dating_db",
    "get_client",
]
