from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional
from .config import get_settings
import logging
import os

_client: Optional[AsyncIOMotorClient] = None
_db = None

async def connect_to_mongo():
    global _client, _db
    settings = get_settings()
    if not settings.mongo_uri and not getattr(settings, "mongo_alt_uri", None):
        raise RuntimeError("Missing MONGO_URI env var for python-service")
    logger = logging.getLogger("uvicorn.error")

    # Allow overriding timeouts via env; choose fast-fail defaults to avoid UI hangs
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
        return client, db

    # First attempt: primary URI (may be SRV)
    primary_error = None
    try:
        _client, _db = await _try_connect(settings.mongo_uri)
        addr = getattr(_client, "address", None)
        if addr:
            logger.info("MongoDB connected: db=%s, primary=%s:%s", settings.mongo_db, addr[0], addr[1])
        else:
            logger.info("MongoDB connected: db=%s", settings.mongo_db)
        # Ensure indexes (idempotent)
        try:
            # Profiles: efficient lookups by username (batch endpoint uses $in)
            await _db["profiles"].create_index("usernameLower", unique=True)
            await _db["profiles"].create_index("username", unique=False)
            logger.info("Ensured indexes on profiles.usernameLower (unique) and profiles.username")
        except Exception as ie:
            logger.error("Failed to create indexes for profiles: %s", ie)
        return
    except Exception as e:
        primary_error = e
        logger.error("Mongo primary URI failed: %s", e)

    # Fallback: alternate direct URI when SRV DNS fails or if provided
    alt_uri = getattr(settings, "mongo_alt_uri", None)
    if alt_uri:
        try:
            _client, _db = await _try_connect(alt_uri)
            addr = getattr(_client, "address", None) 
            if addr:
                logger.info("MongoDB connected via ALT URI: db=%s, primary=%s:%s", settings.mongo_db, addr[0], addr[1])
            else:
                logger.info("MongoDB connected via ALT URI: db=%s", settings.mongo_db)
            try:
                await _db["profiles"].create_index("usernameLower", unique=True)
                await _db["profiles"].create_index("username", unique=False)
                logger.info("Ensured indexes on profiles.usernameLower (unique) and profiles.username")
            except Exception as ie:
                logger.error("Failed to create indexes for profiles: %s", ie)
            return
        except Exception as e2:
            logger.error("Mongo ALT URI failed: %s", e2)

    # If we reach here, both attempts failed
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