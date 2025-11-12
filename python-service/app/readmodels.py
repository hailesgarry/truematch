import asyncio
import time
from typing import Any, Dict

from .db import get_db
from .cache import cache as local_cache
from .cache_bus import handle_cache_event
from .cache_bus import publish_invalidate
from .collections import GROUP_MESSAGES_COLLECTION


def _sanitize_message(doc: Dict) -> Dict:
    if not doc:
        return doc
    d = dict(doc)
    d.pop("_id", None)
    if "reactions" not in d or not isinstance(d["reactions"], dict):
        d["reactions"] = {}
    return d


async def _update_latest_messages(group_id: str, message_id: str, window: int = 200) -> None:
    """Fetch the full message doc and append it to the materialized latest window.
    Also refresh local caches for common sizes.
    """
    db = get_db()
    msg = await db[GROUP_MESSAGES_COLLECTION].find_one({"messageId": message_id})
    if not msg:
        return
    item = _sanitize_message(msg)
    now = int(time.time() * 1000)
    # Append and keep last N items (ascending order as appended)
    await db["read_messages_latest"].update_one(
        {"groupId": group_id},
        {
            "$setOnInsert": {"groupId": group_id, "items": []},
            "$push": {"items": {"$each": [item], "$slice": -int(window)}},
            "$set": {"updatedAt": now},
        },
        upsert=True,
    )
    # Refresh local caches for this group (best-effort)
    try:
        doc = await db["read_messages_latest"].find_one({"groupId": group_id}, {"_id": 0, "items": 1})
        if doc and isinstance(doc.get("items"), list):
            items = doc["items"]
            for n in (50, 100):
                key = f"messages:latest:{group_id}:{n}"
                await local_cache.set(key, items[-n:], ttl_seconds=20)
    except Exception:
        pass


async def event_stream_handler(topic: str, event: Dict[str, Any]) -> None:
    """Handle cross-instance events and update read models/caches."""
    t = (event.get("type") or "").lower()
    # First, process cache bus messages
    await handle_cache_event(topic, event)
    if topic.endswith("messages") and t == "message_created":
        gid = str(event.get("groupId") or "")
        mid = str(event.get("messageId") or "")
        if gid and mid:
            await _update_latest_messages(gid, mid)
            # Invalidate messages latest and page caches across instances
            try:
                await local_cache.delete_prefix(f"messages:latest:{gid}:")
                await local_cache.delete_prefix(f"messages:page:{gid}:")
                await publish_invalidate(f"messages:latest:{gid}:")
                await publish_invalidate(f"messages:page:{gid}:")
            except Exception:
                pass
