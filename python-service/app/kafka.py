import asyncio
import json
from typing import Any, Dict, Optional, Callable

from .config import get_settings

_settings = get_settings()

_producer = None
_consumer_task: Optional[asyncio.Task] = None
_cache_consumer_task: Optional[asyncio.Task] = None


async def _ensure_producer():
    global _producer
    if _producer is not None:
        return _producer
    if not _settings.kafka_enabled or not _settings.kafka_bootstrap:
        return None
    try:
        from aiokafka import AIOKafkaProducer  # type: ignore
    except Exception:
        return None
    _producer = AIOKafkaProducer(
        bootstrap_servers=_settings.kafka_bootstrap,
        client_id=_settings.kafka_client_id,
        linger_ms=5,
        compression_type="lz4",
        max_request_size=1048576,
    )
    try:
        await _producer.start()
    except Exception:
        _producer = None
    return _producer


async def publish(topic: str, event: Dict[str, Any]) -> None:
    """Fire-and-forget publish; failure is non-fatal.
    Topic will be prefixed with KAFKA_TOPIC_PREFIX.
    """
    if not _settings.kafka_enabled or not _settings.kafka_bootstrap:
        return
    producer = await _ensure_producer()
    if not producer:
        return
    full_topic = f"{_settings.kafka_topic_prefix}.{topic}" if _settings.kafka_topic_prefix else topic
    try:
        data = json.dumps(event, separators=(",", ":")).encode("utf-8")
        # Use shortest timeout by scheduling without awaiting result
        asyncio.create_task(producer.send_and_wait(full_topic, data))
    except Exception:
        # Best-effort only
        pass


async def start_consumer(handler: Callable[[str, Dict[str, Any]], asyncio.Future]) -> None:
    """Start a background consumer that invokes handler(topic, eventDict).
    If Kafka is disabled/unavailable or library missing, this is a no-op.
    """
    global _consumer_task, _cache_consumer_task
    if _consumer_task is not None:
        # already running
        return
    if not _settings.kafka_enabled or not _settings.kafka_bootstrap:
        return
    try:
        from aiokafka import AIOKafkaConsumer  # type: ignore
    except Exception:
        return

    async def _run():
        topics = [
            f"{_settings.kafka_topic_prefix}.messages" if _settings.kafka_topic_prefix else "messages",
            f"{_settings.kafka_topic_prefix}.groups" if _settings.kafka_topic_prefix else "groups",
        ]
        consumer = AIOKafkaConsumer(
            *topics,
            bootstrap_servers=_settings.kafka_bootstrap,
            group_id=_settings.kafka_group_id,
            client_id=_settings.kafka_client_id + ":consumer",
            enable_auto_commit=True,
            auto_offset_reset="latest",
            max_partition_fetch_bytes=1048576,
        )
        try:
            await consumer.start()
        except Exception:
            return
        try:
            async for msg in consumer:
                try:
                    payload = json.loads(msg.value.decode("utf-8"))
                except Exception:
                    continue
                try:
                    await handler(msg.topic, payload)
                except Exception:
                    # Ignore handler errors to keep stream alive
                    pass
        finally:
            try:
                await consumer.stop()
            except Exception:
                pass

    _consumer_task = asyncio.create_task(_run())

    # Start a separate broadcast consumer for cache invalidations so ALL instances receive them.
    # Use no group_id to avoid group rebalancing and ensure every consumer gets all messages.
    cache_topic = f"{_settings.kafka_topic_prefix}.cache" if _settings.kafka_topic_prefix else "cache"
    if _cache_consumer_task is None:
        async def _run_cache_broadcast():
            try:
                consumer2 = AIOKafkaConsumer(
                    cache_topic,
                    bootstrap_servers=_settings.kafka_bootstrap,
                    # No group_id -> simple consumer; each instance receives messages
                    enable_auto_commit=False,
                    auto_offset_reset="latest",
                    max_partition_fetch_bytes=1048576,
                )
            except Exception:
                return
            try:
                await consumer2.start()
            except Exception:
                return
            try:
                async for msg in consumer2:
                    try:
                        payload = json.loads(msg.value.decode("utf-8"))
                    except Exception:
                        continue
                    try:
                        await handler(msg.topic, payload)
                    except Exception:
                        pass
            finally:
                try:
                    await consumer2.stop()
                except Exception:
                    pass

        _cache_consumer_task = asyncio.create_task(_run_cache_broadcast())


async def stop():
    global _producer, _consumer_task, _cache_consumer_task
    try:
        if _producer is not None:
            p = _producer
            _producer = None
            await p.stop()
    except Exception:
        pass
    try:
        if _consumer_task is not None:
            _consumer_task.cancel()
            _consumer_task = None
    except Exception:
        pass
    try:
        if _cache_consumer_task is not None:
            _cache_consumer_task.cancel()
            _cache_consumer_task = None
    except Exception:
        pass
