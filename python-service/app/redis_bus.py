import asyncio
import json
from typing import Any, Callable, Dict, Optional

from redis.asyncio import Redis
from redis.asyncio.client import PubSub

from .config import get_settings

_settings = get_settings()
_client: Optional[Redis] = None
_listener_task: Optional[asyncio.Task] = None
_pubsub: Optional[PubSub] = None


def _channel(topic: str) -> str:
    prefix = (_settings.redis_pubsub_prefix or "").strip()
    return f"{prefix}.{topic}" if prefix else topic


async def _ensure_client() -> Optional[Redis]:
    global _client
    if _client is not None:
        return _client
    if not _settings.redis_url:
        return None
    try:
        client = Redis.from_url(
            _settings.redis_url,
            encoding="utf-8",
            decode_responses=False,
        )
        await client.ping()
        _client = client
    except Exception:
        _client = None
    return _client


async def publish(topic: str, event: Dict[str, Any]) -> None:
    if not _settings.redis_pubsub_enabled:
        return
    client = await _ensure_client()
    if not client:
        return
    try:
        payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
        await client.publish(_channel(topic), payload)
    except Exception:
        pass


async def start_consumer(handler: Callable[[str, Dict[str, Any]], asyncio.Future]) -> None:
    global _listener_task, _pubsub
    if _listener_task is not None:
        return
    if not _settings.redis_pubsub_enabled:
        return
    client = await _ensure_client()
    if not client:
        return

    async def _run() -> None:
        nonlocal client
        pubsub = client.pubsub()
        _topics = [_channel(name) for name in ("messages", "groups", "cache")]
        try:
            await pubsub.subscribe(*_topics)
            _pubsub = pubsub
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                raw_channel = message.get("channel")
                raw_data = message.get("data")
                try:
                    channel = raw_channel.decode("utf-8") if isinstance(raw_channel, (bytes, bytearray)) else str(raw_channel)
                    if isinstance(raw_data, (bytes, bytearray)):
                        payload = json.loads(raw_data.decode("utf-8"))
                    else:
                        payload = json.loads(raw_data)
                except Exception:
                    continue
                try:
                    await handler(channel, payload)
                except Exception:
                    pass
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        finally:
            try:
                await pubsub.close()
            except Exception:
                pass
            _pubsub = None

    _listener_task = asyncio.create_task(_run())


async def stop() -> None:
    global _listener_task, _pubsub, _client
    if _listener_task is not None:
        _listener_task.cancel()
        try:
            await _listener_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        _listener_task = None
    if _pubsub is not None:
        try:
            await _pubsub.close()
        except Exception:
            pass
        _pubsub = None
    if _client is not None:
        try:
            await _client.close()
        except Exception:
            pass
        _client = None


async def get_client() -> Optional[Redis]:
    """Return the shared Redis client, if configured."""
    return await _ensure_client()
