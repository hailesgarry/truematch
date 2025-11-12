import asyncio
import json
import ssl
from typing import Any, Dict, Optional, Callable

from .config import get_settings

_settings = get_settings()
"""Compatibility layer forwarding legacy Kafka imports to the Redis event bus."""

from .redis_bus import publish, start_consumer, stop  # noqa: F401
_cache_consumer_task: Optional[asyncio.Task] = None
