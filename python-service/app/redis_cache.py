import json
from typing import Any, Optional

from .config import get_settings
from .redis_bus import get_client

_settings = get_settings()
_CACHE_NAMESPACE = "cache:"


def _redis_key(key: str) -> str:
    prefix = (_settings.redis_pubsub_prefix or "").strip()
    ns = _CACHE_NAMESPACE
    if prefix:
        ns = f"{prefix}:{_CACHE_NAMESPACE}"
    return f"{ns}{key}"


async def get(key: str) -> Optional[Any]:
    client = await get_client()
    if not client:
        return None
    try:
        raw = await client.get(_redis_key(key))
        if raw is None:
            return None
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8")
        return json.loads(raw)
    except Exception:
        return None


async def set(key: str, value: Any, ttl_seconds: int) -> None:
    client = await get_client()
    if not client:
        return
    try:
        payload = json.dumps(value, separators=(",", ":"))
        ttl = max(1, int(ttl_seconds))
        await client.set(_redis_key(key), payload, ex=ttl)
    except Exception:
        pass


async def delete_prefix(prefix: str) -> int:
    client = await get_client()
    if not client:
        return 0
    pattern = _redis_key(prefix) + "*"
    deleted = 0
    try:
        async for name in client.scan_iter(match=pattern):
            try:
                await client.delete(name)
                deleted += 1
            except Exception:
                continue
    except Exception:
        return deleted
    return deleted
