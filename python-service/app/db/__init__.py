from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional
from ..config import get_settings
import logging
import os

_client: Optional[AsyncIOMotorClient] = None
_db = None

async def _ensure_core_indexes(db):
    try:
        await db["profiles"].create_index("usernameLower", unique=True)
        await db["profiles"].create_index("username", unique=False)
        logging.getLogger("uvicorn.error").info(
            "Ensured profile indexes on usernameLower and username"
        )
    except Exception as exc:
        logging.getLogger("uvicorn.error").error(
            "Failed to ensure profile indexes: %s", exc
        )
    try:
        from .mongo import ensure_likes_indexes
        await ensure_likes_indexes(db)
    except Exception as exc:
        logging.getLogger("uvicorn.error").error(
            "Failed to ensure likes indexes: %s", exc
        )

async def connect_to_mongo():
    global _client, _db
    settings = get_settings()
    if not settings.mongo_uri and not getattr(settings, "mongo_alt_uri", None):
        raise RuntimeError("Missing MONGO_URI env var for python-service")
    logger = logging.getLogger("uvicorn.error")

    sel_timeout_ms = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "3000"))
    conn_timeout_ms = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "3000"))
    sock_timeout_ms = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "5000"))

    async def _try_connect(uri: str):
        client = AsyncIOMotorClient(
            uri,
            maxPoolSize=20,
            serverSelectionTimeoutMS=sel_timeout_ms,
            connectTimeoutMS=conn_timeout_ms,
            socketTimeoutMS=sock_timeout_ms,
            **({"directConnection": True} if getattr(settings, "mongo_direct", False) else {}),
        )
        db = client[settings.mongo_db]
        await client.admin.command("ping")
        await _ensure_core_indexes(db)
        return client, db

    primary_error = None
    try:
        _client, _db = await _try_connect(settings.mongo_uri)
        addr = getattr(_client, "address", None)
        if addr:
            logger.info(
                "MongoDB connected: db=%s, primary=%s:%s",
                settings.mongo_db,
                addr[0],
                addr[1],
            )
        else:
            logger.info("MongoDB connected: db=%s", settings.mongo_db)
        return
    except Exception as exc:
        primary_error = exc
        logger.error("Mongo primary URI failed: %s", exc)

    alt_uri = getattr(settings, "mongo_alt_uri", None)
    if alt_uri:
        try:
            _client, _db = await _try_connect(alt_uri)
            addr = getattr(_client, "address", None)
            if addr:
                logger.info(
                    "MongoDB connected via ALT URI: db=%s, primary=%s:%s",
                    settings.mongo_db,
                    addr[0],
                    addr[1],
                )
            else:
                logger.info("MongoDB connected via ALT URI: db=%s", settings.mongo_db)
            return
        except Exception as exc:
            logger.error("Mongo ALT URI failed: %s", exc)

    raise primary_error or RuntimeError("Mongo connection failed")

async def close_mongo_connection():
    global _client
    if _client:
        try:
            _client.close()
        finally:
            logging.getLogger("uvicorn.error").info("MongoDB connection closed")
        _client = None

def get_db():
    if _db is None:
        raise RuntimeError("MongoDB not connected. Did you call connect_to_mongo()?")
    return _db

__all__ = [
    "connect_to_mongo",
    "close_mongo_connection",
    "get_db",
]
