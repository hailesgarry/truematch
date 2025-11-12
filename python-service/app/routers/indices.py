from fastapi import APIRouter, HTTPException
from ..db import get_db
from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..collections import GROUP_MESSAGES_COLLECTION, DM_MESSAGES_COLLECTION

router = APIRouter()


@router.post("/admin/ensure-indexes")
async def ensure_indexes():
    db = get_db()
    # Group messages: lookups by roomId/groupId, messageId, timestamp, createdAt
    await db[GROUP_MESSAGES_COLLECTION].create_index([("roomId", 1), ("createdAt", 1)])
    await db[GROUP_MESSAGES_COLLECTION].create_index([("groupId", 1), ("createdAt", 1)])
    await db[GROUP_MESSAGES_COLLECTION].create_index([("roomId", 1), ("createdAt", -1)])
    await db[GROUP_MESSAGES_COLLECTION].create_index([("groupId", 1), ("createdAt", -1)])
    await db[GROUP_MESSAGES_COLLECTION].create_index([("roomId", 1), ("timestamp", 1)])
    await db[GROUP_MESSAGES_COLLECTION].create_index([("groupId", 1), ("timestamp", 1)])
    await db[GROUP_MESSAGES_COLLECTION].create_index([("messageId", 1)], unique=False)

    # Direct messages: lookups by dmId, messageId, timestamp, createdAt (legacy roomId/groupId included for safety)
    await db[DM_MESSAGES_COLLECTION].create_index([("dmId", 1), ("createdAt", 1)])
    await db[DM_MESSAGES_COLLECTION].create_index([("dmId", 1), ("createdAt", -1)])
    await db[DM_MESSAGES_COLLECTION].create_index([("dmId", 1), ("timestamp", 1)])
    await db[DM_MESSAGES_COLLECTION].create_index([("messageId", 1)], unique=False)
    await db[DM_MESSAGES_COLLECTION].create_index([("roomId", 1), ("createdAt", 1)])
    await db[DM_MESSAGES_COLLECTION].create_index([("roomId", 1), ("createdAt", -1)])
    await db[DM_MESSAGES_COLLECTION].create_index([("groupId", 1), ("createdAt", 1)])
    await db[DM_MESSAGES_COLLECTION].create_index([("groupId", 1), ("createdAt", -1)])

    # Likes: incoming/outgoing queries
    await db["likes"].create_index([("toLc", 1), ("at", -1)])
    await db["likes"].create_index([("fromLc", 1), ("at", -1)])

    # Message filters per user/group/username
    try:
        await db["message_filters"].create_index(
            [("userId", 1), ("groupId", 1), ("usernameLower", 1)], unique=True
        )
        await db["message_filters"].create_index([("userId", 1)])
    except Exception:
        pass

    # Groups and profiles commonly accessed
    await db["groups"].create_index([("id", 1)], unique=True)
    # Use case-insensitive unique via usernameLower; keep username non-unique to avoid conflicts
    await db["profiles"].create_index([("username", 1)], unique=False)
    try:
        await db["profiles"].create_index(
            [("location.coordinates", "2dsphere")],
            name="profiles_location_2dsphere",
        )
    except Exception:
        pass

    # Explicit group membership
    try:
        await db["group_members"].create_index([("groupId", 1), ("usernameLower", 1)], unique=True)
        await db["group_members"].create_index([("groupId", 1), ("joinedAt", -1)])
    except Exception:
        pass

    # Read model collection for faster latest reads
    try:
        await db["read_messages_latest"].create_index([("groupId", 1)], unique=True)
        await db["read_messages_latest"].create_index([("updatedAt", -1)])
    except Exception:
        pass

    return {"ok": True}

@router.post("/admin/readmodels/backfill")
async def backfill_readmodels(limit_groups: int = 50, window: int = 200):
    """Backfill the read model for latest messages per group by scanning existing data.
    Best-effort and bounded by limit_groups and window size.
    """
    db = get_db()
    groups = await db["groups"].find({}, {"_id": 0, "id": 1}).limit(limit_groups).to_list(length=limit_groups)
    count = 0
    for g in groups:
        gid = g.get("id")
        if not gid:
            continue
        items = []
        projection = {
            "_id": 0,
            "roomId": 1,
            "groupId": 1,
            "messageId": 1,
            "timestamp": 1,
            "createdAt": 1,
            "username": 1,
            "text": 1,
            "bubbleColor": 1,
            "reactions": 1,
            "replyTo": 1,
            "kind": 1,
            "media": 1,
        }
        cur = db[GROUP_MESSAGES_COLLECTION].find({"groupId": gid}, projection).sort("createdAt", -1).limit(window)
        async for x in cur:
            x.pop("_id", None)
            items.append(x)
        items = list(reversed(items))
        now_ms = int(__import__("time").time() * 1000)
        await db["read_messages_latest"].update_one(
            {"groupId": gid},
            {"$set": {"groupId": gid, "items": items, "updatedAt": now_ms}},
            upsert=True,
        )
        count += 1
    return {"groupsProcessed": count}


@router.post("/admin/cache/purge")
async def purge_cache(prefix: str, token: str = ""):
    """Purge caches by prefix across instances. Best-effort.
    For safety, require a simple token via env ADMIN_TOKEN; if unset, allow only localhost via deployment gateway.
    """
    import os
    admin_token = os.getenv("ADMIN_TOKEN", "")
    if admin_token and token != admin_token:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not isinstance(prefix, str) or not prefix:
        raise HTTPException(status_code=400, detail="prefix required")
    removed_local = await local_cache.delete_prefix(prefix)
    try:
        await publish_invalidate(prefix)
    except Exception:
        pass
    return {"removedLocal": removed_local, "broadcast": True}
