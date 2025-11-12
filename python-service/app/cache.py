import time
import asyncio
from typing import Any, Dict, Optional


class TTLCache:
    def __init__(self):
        # key -> (value_str, expires_at)
        self._store: Dict[str, tuple[Any, float]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        now = time.time()
        async with self._lock:
            item = self._store.get(key)
            if not item:
                return None
            value, exp = item
            if exp and exp < now:
                # expired
                self._store.pop(key, None)
                return None
            return value

    async def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        exp = time.time() + max(0, int(ttl_seconds))
        async with self._lock:
            self._store[key] = (value, exp)

    async def delete_prefix(self, prefix: str) -> int:
        async with self._lock:
            keys = [k for k in self._store.keys() if k.startswith(prefix)]
            for k in keys:
                self._store.pop(k, None)
            return len(keys)


cache = TTLCache()
