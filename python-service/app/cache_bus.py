from typing import Any, Dict

from .cache import cache as local_cache

async def handle_cache_event(topic: str, event: Dict[str, Any]) -> None:
    """Consume cache bus events and apply local invalidations.
    Expected events on topic 'cache' with shape: { type: 'invalidate', pattern: '<prefix>' }
    """
    try:
        if not topic.endswith("cache"):
            return
        et = str(event.get("type") or "").lower()
        if et == "invalidate":
            pat = str(event.get("pattern") or "")
            if pat:
                await local_cache.delete_prefix(pat)
    except Exception:
        # Best-effort only
        pass

async def publish_invalidate(pattern: str) -> None:
    """Publish an invalidation event to the cache topic. Safe no-op if Kafka disabled."""
    try:
        from .kafka import publish as kafka_publish  # lazy import to avoid cycles
    except Exception:
        return
    try:
        await kafka_publish("cache", {"type": "invalidate", "pattern": pattern})
    except Exception:
        # Non-fatal
        pass
