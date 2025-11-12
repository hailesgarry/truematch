import os
from functools import lru_cache
from pydantic import BaseModel, Field
from pathlib import Path as _Path

# Fallback: attempt to load .env early if not already loaded
try:
    from dotenv import load_dotenv as _load_dotenv  # type: ignore
    _load_dotenv(dotenv_path=_Path(__file__).resolve().parent.parent / ".env", override=False)
except Exception:
    pass

def _redis_pubsub_enabled_default() -> bool:
    explicit = os.getenv("REDIS_PUBSUB_ENABLED")
    if explicit is not None:
        return explicit.lower() in ("1", "true", "yes")
    legacy = os.getenv("KAFKA_ENABLED")
    if legacy is not None:
        return legacy.lower() in ("1", "true", "yes")
    return bool(os.getenv("REDIS_URL"))


class Settings(BaseModel):
    # Support multiple common env var names for Mongo connection string
    mongo_uri: str = Field(
        default_factory=lambda: (
            os.getenv("MONGO_URI")
            or os.getenv("MONGODB_URI")
            or os.getenv("MONGO_URL")
            or ""
        )
    )
    mongo_db: str = Field(default_factory=lambda: os.getenv("MONGO_DB_NAME", "truematch"))
    # Optional: provide a non-SRV fallback URI (e.g., mongodb://127.0.0.1:27017)
    mongo_alt_uri: str = Field(default_factory=lambda: os.getenv("MONGO_ALT_URI", ""))
    # Optional: force direct connection (applies to non-SRV URIs)
    mongo_direct: bool = Field(default_factory=lambda: os.getenv("MONGO_DIRECT", "false").lower() in ("1", "true", "yes"))
    cors_origin: str = Field(default_factory=lambda: os.getenv("CORS_ORIGIN", "http://localhost:5173"))
    port: int = Field(default_factory=lambda: int(os.getenv("PY_BACKEND_PORT", "8081")))
    # Web Push (VAPID)
    vapid_public_key: str = Field(default_factory=lambda: os.getenv("VAPID_PUBLIC_KEY", ""))
    vapid_private_key: str = Field(default_factory=lambda: os.getenv("VAPID_PRIVATE_KEY", ""))
    vapid_subject: str = Field(default_factory=lambda: os.getenv("VAPID_SUBJECT", "mailto:admin@example.com"))

    # Redis (caching + pub/sub)
    redis_url: str = Field(default_factory=lambda: os.getenv("REDIS_URL", ""))
    redis_pubsub_enabled: bool = Field(default_factory=_redis_pubsub_enabled_default)
    redis_pubsub_prefix: str = Field(default_factory=lambda: os.getenv("REDIS_PUBSUB_PREFIX", os.getenv("KAFKA_TOPIC_PREFIX", "tm")))

    # Atlas Search
    atlas_search_enabled: bool = Field(default_factory=lambda: os.getenv("ATLAS_SEARCH_ENABLED", "false").lower() in ("1", "true", "yes"))
    atlas_search_index: str = Field(default_factory=lambda: os.getenv("ATLAS_SEARCH_INDEX", "default"))
    atlas_autocomplete_enabled: bool = Field(default_factory=lambda: os.getenv("ATLAS_AUTOCOMPLETE_ENABLED", "false").lower() in ("1", "true", "yes"))

@lru_cache()
def get_settings() -> Settings:
    return Settings()