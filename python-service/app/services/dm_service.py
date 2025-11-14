from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..collections import DM_MESSAGES_COLLECTION
from ..models.dm import (
    DmMessage,
    MessageCreateRequest,
    MessageEditRequest,
    MessageReactionRequest,
)
from ..services.message_service import (
    resolve_reply_reference,
    sanitize_message,
    summarize_reactions,
)


def sanitize_dm_message(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    sanitized = sanitize_message(doc)
    if "dmId" in sanitized:
        sanitized["roomId"] = sanitized.get("roomId") or sanitized["dmId"]
    return sanitized


def dm_participants(dm_id: str) -> List[str]:
    try:
        rest = str(dm_id or "")[3:]
        parts = sorted([p.strip().lower() for p in rest.split("|") if p.strip()])
        return parts if len(parts) == 2 else []
    except Exception:
        return []


async def fetch_latest_messages(db, dm_id: str, count: int) -> List[Dict[str, Any]]:
    cur = (
        db[DM_MESSAGES_COLLECTION]
        .find({"dmId": dm_id})
        .sort("createdAt", 1)
        .limit(count)
    )
    out: List[Dict[str, Any]] = []
    async for doc in cur:
        payload = sanitize_dm_message(doc)
        rt = payload.get("replyTo") if isinstance(payload, dict) else None
        if isinstance(rt, dict):
            if not isinstance(rt.get("text"), str) or rt.get("text", "").strip() == "":
                enriched = await resolve_reply_reference(
                    db,
                    dm_id,
                    rt,
                    collection_name=DM_MESSAGES_COLLECTION,
                )
                payload["replyTo"] = enriched
        out.append(payload)
    return out


async def create_dm_message(
    db,
    dm_id: str,
    payload: MessageCreateRequest,
) -> Dict[str, Any]:
    import datetime as _dt

    ts = _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc).isoformat()
    mid = str(uuid.uuid4())
    incoming_rt = payload.reply_to if isinstance(payload.reply_to, dict) else None
    loose_ref = None
    if not incoming_rt:
        rid = payload.reply_to_message_id
        rts = payload.reply_to_timestamp
        if rid or rts:
            loose_ref = {k: v for k, v in (("messageId", rid), ("timestamp", rts)) if v}
    merged_ref = {**(loose_ref or {}), **(incoming_rt or {})} if (incoming_rt or loose_ref) else None
    reply_ref = await resolve_reply_reference(
        db,
        dm_id,
        merged_ref,
        collection_name=DM_MESSAGES_COLLECTION,
    )

    doc = {
        "dmId": dm_id,
        "messageId": mid,
        "timestamp": ts,
        "createdAt": int(time.time() * 1000),
        "userId": payload.user_id,
        "username": payload.username,
        "avatar": getattr(payload, "avatar", None),
        "bubbleColor": payload.bubble_color,
        "text": str(payload.text or ""),
        "kind": payload.kind,
        "media": payload.media,
        "audio": getattr(payload, "audio", None),
        "replyTo": reply_ref,
        "edited": False,
        "lastEditedAt": None,
        "edits": [],
        "deleted": False,
        "deletedAt": None,
        "reactions": {},
        "roomId": dm_id,
        "groupId": dm_id,
    }

    await db[DM_MESSAGES_COLLECTION].insert_one(doc)

    try:
        await local_cache.delete_prefix(f"dm:latest:{dm_id}:")
        await publish_invalidate(f"dm:latest:{dm_id}:")
        await local_cache.delete_prefix(f"dm:page:{dm_id}:")
        await publish_invalidate(f"dm:page:{dm_id}:")
        for user in dm_participants(dm_id):
            await local_cache.delete_prefix(f"dm:threads:{user}")
            await publish_invalidate(f"dm:threads:{user}")
    except Exception:
        pass

    return sanitize_dm_message(doc)


async def edit_dm_message(
    db,
    dm_id: str,
    message_id: str,
    body: MessageEditRequest,
) -> Dict[str, Any]:
    new_text = body.new_text
    if not new_text:
        raise HTTPException(status_code=400, detail="newText required")
    doc = await db[DM_MESSAGES_COLLECTION].find_one(
        {"dmId": dm_id, "messageId": message_id}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    import datetime as _dt

    now = _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc).isoformat()
    edits = list(doc.get("edits") or [])
    edits.append({"previousText": doc.get("text", ""), "editedAt": now})
    await db[DM_MESSAGES_COLLECTION].update_one(
        {"dmId": dm_id, "messageId": message_id},
        {"$set": {"text": new_text, "edited": True, "lastEditedAt": now, "edits": edits}},
    )
    try:
        await local_cache.delete_prefix(f"dm:latest:{dm_id}:")
        await publish_invalidate(f"dm:latest:{dm_id}:")
        await local_cache.delete_prefix(f"dm:page:{dm_id}:")
        await publish_invalidate(f"dm:page:{dm_id}:")
    except Exception:
        pass
    return {"success": True, "lastEditedAt": now, "edited": True}


async def delete_dm_message(db, dm_id: str, message_id: str) -> Dict[str, Any]:
    doc = await db[DM_MESSAGES_COLLECTION].find_one(
        {"dmId": dm_id, "messageId": message_id}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    import datetime as _dt

    now = _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc).isoformat()
    await db[DM_MESSAGES_COLLECTION].update_one(
        {"dmId": dm_id, "messageId": message_id},
        {
            "$set": {"deleted": True, "deletedAt": now, "text": ""},
            "$unset": {"media": "", "audio": ""},
        },
    )
    try:
        doc_ts = doc.get("timestamp")
        doc_user = doc.get("username")
        reply_or = [{"replyTo.messageId": message_id}]
        if doc_ts and doc_user:
            reply_or.append(
                {
                    "$and": [
                        {"replyTo.timestamp": doc_ts},
                        {"replyTo.username": doc_user},
                    ]
                }
            )
        await db[DM_MESSAGES_COLLECTION].update_many(
            {
                "$and": [
                    {"dmId": dm_id},
                    {"$or": reply_or},
                ]
            },
            {
                "$set": {
                    "replyTo.deleted": True,
                    "replyTo.deletedAt": now,
                    "replyTo.text": "",
                },
                "$unset": {
                    "replyTo.media": "",
                    "replyTo.audio": "",
                },
            },
        )
    except Exception:
        pass
    try:
        await local_cache.delete_prefix(f"dm:latest:{dm_id}:")
        await publish_invalidate(f"dm:latest:{dm_id}:")
        await local_cache.delete_prefix(f"dm:page:{dm_id}:")
        await publish_invalidate(f"dm:page:{dm_id}:")
    except Exception:
        pass
    return {"success": True, "deletedAt": now}


async def react_to_dm_message(
    db,
    dm_id: str,
    message_id: str,
    body: MessageReactionRequest,
) -> Dict[str, Any]:
    emoji = body.emoji
    user = body.user or {}
    user_id = user.get("userId") if isinstance(user, dict) else None
    username = user.get("username") if isinstance(user, dict) else None
    if not user_id:
        raise HTTPException(status_code=400, detail="user.userId required")
    doc = await db[DM_MESSAGES_COLLECTION].find_one(
        {"dmId": dm_id, "messageId": message_id}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    reactions = dict(doc.get("reactions") or {})
    current = (reactions.get(user_id) or {}).get("emoji")
    now_ms = int(time.time() * 1000)
    if not emoji or (isinstance(emoji, str) and emoji.strip() == "") or current == emoji:
        reactions.pop(user_id, None)
    else:
        reactions[user_id] = {
            "emoji": emoji,
            "at": now_ms,
            "userId": user_id,
            "username": username,
        }
    await db[DM_MESSAGES_COLLECTION].update_one(
        {"dmId": dm_id, "messageId": message_id},
        {"$set": {"reactions": reactions}},
    )
    try:
        await local_cache.delete_prefix(f"dm:latest:{dm_id}:")
        await publish_invalidate(f"dm:latest:{dm_id}:")
        await local_cache.delete_prefix(f"dm:page:{dm_id}:")
        await publish_invalidate(f"dm:page:{dm_id}:")
    except Exception:
        pass
    summary = summarize_reactions(reactions)
    return {
        "success": True,
        "messageId": message_id,
        "reactions": reactions,
        "summary": summary.dict(by_alias=True),
    }


async def fetch_dm_threads(db, username: str) -> Dict[str, Any]:
    u = (username or "").strip().lower()
    if not u:
        return {"threads": []}

    pipeline = [
        {"$match": {"dmId": {"$regex": r"^dm:"}}},
        {"$sort": {"createdAt": -1}},
        {
            "$group": {
                "_id": "$dmId",
                "latest": {"$first": "$createdAt"},
                "last": {"$first": "$$ROOT"},
            }
        },
        {"$sort": {"latest": -1}},
    ]

    cur = db[DM_MESSAGES_COLLECTION].aggregate(pipeline)
    threads: List[Dict[str, Any]] = []

    async for row in cur:
        dm_id = row.get("_id")
        rest = str(dm_id or "")[3:]
        parts = sorted([p.strip().lower() for p in rest.split("|") if p.strip()])
        if len(parts) != 2 or u not in parts:
            continue

        preview: Optional[Dict[str, Any]] = None
        last_doc = row.get("last")
        if isinstance(last_doc, dict):
            preview = sanitize_dm_message(last_doc)
            if preview is not None:
                preview.pop("roomId", None)
                preview.pop("groupId", None)
                preview.pop("dmId", None)
                rt = preview.get("replyTo")
                if isinstance(rt, dict):
                    try:
                        preview["replyTo"] = await resolve_reply_reference(
                            db,
                            dm_id,
                            rt,
                            collection_name=DM_MESSAGES_COLLECTION,
                        )
                    except Exception:
                        pass

        entry = {"dmId": dm_id, "latest": row.get("latest")}
        if preview:
            entry["last"] = preview
        threads.append(entry)

    return {"threads": threads}


async def fetch_dm_page(
    db,
    dm_id: str,
    *,
    before: Optional[int] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    n = max(1, min(int(limit or 50), 200))
    projection = {
        "_id": 0,
        "dmId": 1,
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
        "audio": 1,
        "deleted": 1,
        "deletedAt": 1,
        "edited": 1,
        "lastEditedAt": 1,
    }
    query: Dict[str, Any] = {"dmId": dm_id}
    if before is not None:
        query["createdAt"] = {"$lt": int(before)}
    cursor = (
        db[DM_MESSAGES_COLLECTION]
        .find(query, projection)
        .sort("createdAt", -1)
        .limit(n)
    )
    items: List[Dict[str, Any]] = []
    async for doc in cursor:
        payload = sanitize_dm_message(doc)
        rt = payload.get("replyTo") if isinstance(payload, dict) else None
        if isinstance(rt, dict):
            if not isinstance(rt.get("text"), str) or rt.get("text", "").strip() == "":
                enriched = await resolve_reply_reference(
                    db,
                    dm_id,
                    rt,
                    collection_name=DM_MESSAGES_COLLECTION,
                )
                payload["replyTo"] = enriched
        items.append(payload)
    items.reverse()
    next_cursor = items[0]["createdAt"] if items else None
    return {"messages": items, "next": next_cursor}


__all__ = [
    "sanitize_dm_message",
    "dm_participants",
    "fetch_latest_messages",
    "create_dm_message",
    "edit_dm_message",
    "delete_dm_message",
    "react_to_dm_message",
    "fetch_dm_threads",
    "fetch_dm_page",
]
