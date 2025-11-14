from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..collections import DM_MESSAGES_COLLECTION, GROUP_MESSAGES_COLLECTION
from ..models.message import (
    MessageCreateRequest,
    MessageEditRequest,
    MessageReactionRequest,
    MessageBase,
    ReactionSummary,
)
from ..redis_bus import publish as redis_publish
from ..redis_cache import (
    delete_prefix as redis_cache_delete_prefix,
    get as redis_cache_get,
    set as redis_cache_set,
)
from ..utils.http import weak_etag

LATEST_CACHE_TTL = 15


def _now_iso() -> str:
    import datetime as _dt

    return _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc).isoformat()


async def invalidate_latest_cache(group_id: str) -> None:
    prefix = f"messages:latest:{group_id}:"
    try:
        await local_cache.delete_prefix(prefix)
    except Exception:
        pass
    try:
        await redis_cache_delete_prefix(prefix)
    except Exception:
        pass
    try:
        await publish_invalidate(prefix)
    except Exception:
        pass


def summarize_reactions(reactions: Dict[str, Any]) -> ReactionSummary:
    entries = list((reactions or {}).values())
    if not entries:
        return ReactionSummary(totalCount=0, mostRecent=None)
    most = max(entries, key=lambda e: int(e.get("at", 0)))
    return ReactionSummary(
        totalCount=len(entries),
        mostRecent={
            "emoji": most.get("emoji"),
            "at": most.get("at"),
            "userId": most.get("userId"),
            "username": most.get("username"),
        },
    )


def _thread_scope_filter(scope_id: str, collection_name: str) -> Dict[str, Any]:
    clauses: List[Dict[str, Any]] = []
    if collection_name == GROUP_MESSAGES_COLLECTION:
        clauses.extend([
            {"roomId": scope_id},
            {"groupId": scope_id},
        ])
    else:
        clauses.extend([
            {"dmId": scope_id},
            {"roomId": scope_id},
            {"groupId": scope_id},
        ])
    if not clauses:
        return {"roomId": scope_id}
    return {"$or": clauses}


async def resolve_reply_reference(
    db,
    scope_id: str,
    ref: Optional[Dict[str, Any]],
    *,
    collection_name: str = GROUP_MESSAGES_COLLECTION,
) -> Optional[Dict[str, Any]]:
    if not ref or not isinstance(ref, dict):
        return None

    collection = db[collection_name]
    scope_filter = _thread_scope_filter(scope_id, collection_name)

    out = {
        k: v
        for k, v in ref.items()
        if k
        in {
            "messageId",
            "username",
            "text",
            "timestamp",
            "kind",
            "media",
            "audio",
            "deleted",
            "deletedAt",
        }
    }

    needs_text = not isinstance(out.get("text"), str) or out.get("text", "").strip() == ""
    try:
        original = None
        if needs_text and ref.get("messageId"):
            original = await collection.find_one(
                {"$and": [{"messageId": ref["messageId"]}, scope_filter]}
            )
        if needs_text and not original and ref.get("timestamp"):
            original = await collection.find_one(
                {"$and": [{"timestamp": ref["timestamp"]}, scope_filter]}
            )
        if original:
            out.setdefault("messageId", original.get("messageId"))
            out.setdefault("username", original.get("username"))
            out["text"] = original.get("text", "")
            out.setdefault("timestamp", original.get("timestamp"))
            if original.get("kind"):
                out.setdefault("kind", original.get("kind"))
            if original.get("deleted"):
                out["deleted"] = True
                if original.get("deletedAt"):
                    out.setdefault("deletedAt", original.get("deletedAt"))
            if original.get("media") and "media" not in out:
                out["media"] = original.get("media")
            if original.get("audio") and "audio" not in out:
                out["audio"] = original.get("audio")
    except Exception:
        pass

    if "text" not in out or out["text"] is None:
        out["text"] = ""

    return out


def sanitize_message(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not doc:
        return {}
    clone = dict(doc)
    clone.pop("_id", None)
    if "reactions" not in clone or not isinstance(clone["reactions"], dict):
        clone["reactions"] = {}
    return clone


async def get_latest_messages(
    db,
    group_id: str,
    count: int,
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    try:
        doc = await db["read_messages_latest"].find_one(
            {"groupId": group_id},
            {"_id": 0, "items": {"$slice": -int(count)}},
        )
        candidates = (doc or {}).get("items") or []
        if candidates:
            items = [
                sanitize_message(message)
                for message in candidates[-count:]
                if isinstance(message, dict)
            ]
    except Exception:
        items = []

    if not items:
        scope = {"$or": [{"groupId": group_id}, {"roomId": group_id}]}
        cursor = (
            db[GROUP_MESSAGES_COLLECTION]
            .find(scope)
            .sort("createdAt", -1)
            .limit(int(count))
        )
        latest_desc: List[Dict[str, Any]] = []
        async for doc in cursor:
            latest_desc.append(sanitize_message(doc))
        latest_desc.reverse()
        items = latest_desc

    enriched: List[Dict[str, Any]] = []
    for message in items:
        if not isinstance(message, dict):
            continue
        rt = message.get("replyTo")
        if isinstance(rt, dict):
            txt = rt.get("text")
            try:
                if not isinstance(txt, str) or txt.strip() == "":
                    resolved = await resolve_reply_reference(
                        db,
                        group_id,
                        rt,
                        collection_name=GROUP_MESSAGES_COLLECTION,
                    )
                    if resolved:
                        message = {**message, "replyTo": resolved}
            except Exception:
                pass
        enriched.append(message)

    return enriched


def _derive_preview(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    return {
        "username": doc.get("username"),
        "text": doc.get("text"),
        "kind": doc.get("kind"),
        "timestamp": doc.get("timestamp"),
        "media": doc.get("media"),
    }


async def get_inbox_previews(
    db,
    joined_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    previews: List[Dict[str, Any]] = []

    try:
        query = {"id": {"$in": joined_ids}} if joined_ids else {}
        groups_cur = db["groups"].find(query, {"_id": 0, "id": 1}).limit(200)
        group_ids = [g.get("id") async for g in groups_cur if g.get("id")]
        for gid in group_ids:
            latest = None
            try:
                doc = await db["read_messages_latest"].find_one(
                    {"groupId": gid},
                    {"_id": 0, "items": {"$slice": -1}},
                )
                items = (doc or {}).get("items") or []
                latest = items[-1] if items else None
            except Exception:
                latest = None
            if not latest:
                cur = (
                    db[GROUP_MESSAGES_COLLECTION]
                    .find({"groupId": gid}, {"_id": 0})
                    .sort("createdAt", -1)
                    .limit(1)
                )
                latest_list = await cur.to_list(length=1)
                latest = latest_list[0] if latest_list else None
            if latest:
                p = _derive_preview(latest)
                p["threadId"] = gid
                previews.append(p)

        dm_latest: Dict[str, Dict[str, Any]] = {}
        cur = (
            db[DM_MESSAGES_COLLECTION]
            .find(
                {"dmId": {"$exists": True}},
                {
                    "_id": 0,
                    "dmId": 1,
                    "createdAt": 1,
                    "username": 1,
                    "text": 1,
                    "kind": 1,
                    "timestamp": 1,
                },
            )
            .sort("createdAt", -1)
            .limit(1000)
        )
        async for doc in cur:
            dm_id = doc.get("dmId")
            if not dm_id:
                continue
            if dm_id in dm_latest:
                continue
            dm_latest[dm_id] = doc
        for dm_id, doc in dm_latest.items():
            p = _derive_preview(doc)
            p["threadId"] = dm_id
            previews.append(p)
    except Exception:
        pass

    try:
        previews = previews[:1000]
    except Exception:
        pass

    return previews


async def create_group_message(
    db,
    group_id: str,
    payload: MessageCreateRequest,
) -> Dict[str, Any]:
    ts = _now_iso()
    mid = str(uuid.uuid4())

    incoming_rt = payload.reply_to if isinstance(payload.reply_to, dict) else None
    loose_ref = None
    if not incoming_rt:
        rid = payload.reply_to_message_id
        rts = payload.reply_to_timestamp
        if rid or rts:
            loose_ref = {k: v for k, v in (("messageId", rid), ("timestamp", rts)) if v}
    merged_ref = {**(loose_ref or {}), **(incoming_rt or {})} if (incoming_rt or loose_ref) else None
    reply_ref = await resolve_reply_reference(db, group_id, merged_ref)

    doc = {
        "roomId": group_id,
        "groupId": group_id,
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
    }

    await db[GROUP_MESSAGES_COLLECTION].insert_one(doc)

    try:
        await redis_publish(
            "messages",
            {
                "type": "message_created",
                "groupId": group_id,
                "messageId": mid,
                "createdAt": doc["createdAt"],
                "username": doc.get("username"),
                "userId": doc.get("userId"),
                "text": doc.get("text"),
            },
        )
    except Exception:
        pass

    try:
        await local_cache.delete_prefix("groups:list:")
    except Exception:
        pass
    try:
        await publish_invalidate("groups:list:")
    except Exception:
        pass
    try:
        await invalidate_latest_cache(group_id)
    except Exception:
        pass

    return sanitize_message(doc)


async def get_recordings_by_user(
    db,
    username: str,
    limit: int = 50,
    group_id: Optional[str] = None,
) -> Dict[str, Any]:
    n = max(1, min(int(limit or 50), 200))
    uname = (username or "").strip().lower()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    filt: Dict[str, Any] = {
        "$and": [
            {"kind": "audio"},
            {"$expr": {"$eq": [{"$toLower": "$username"}, uname]}},
        ]
    }
    if group_id:
        filt["$and"].append({"$or": [{"groupId": group_id}, {"roomId": group_id}]})
    projection = {
        "_id": 0,
        "messageId": 1,
        "groupId": 1,
        "roomId": 1,
        "timestamp": 1,
        "createdAt": 1,
        "username": 1,
        "audio": 1,
        "kind": 1,
    }
    items: List[Dict[str, Any]] = []
    cur = (
        db[GROUP_MESSAGES_COLLECTION]
        .find(filt, projection)
        .sort("createdAt", -1)
        .limit(n)
    )
    async for d in cur:
        items.append(sanitize_message(d))
    return {"items": items}


async def backfill_replies(
    db,
    group_id: str,
    limit: int = 200,
) -> Dict[str, int]:
    n = max(1, min(int(limit or 200), 1000))
    cur = (
        db[GROUP_MESSAGES_COLLECTION]
        .find({"$or": [{"roomId": group_id}, {"groupId": group_id}]})
        .sort("createdAt", -1)
        .limit(n)
    )
    checked = 0
    updated = 0
    async for doc in cur:
        checked += 1
        rt = doc.get("replyTo")
        if not isinstance(rt, dict):
            continue
        txt = rt.get("text")
        if isinstance(txt, str) and txt.strip() != "":
            continue
        enriched = await resolve_reply_reference(db, group_id, rt)
        try:
            await db[GROUP_MESSAGES_COLLECTION].update_one(
                {"_id": doc["_id"]}, {"$set": {"replyTo": enriched}}
            )
            updated += 1
        except Exception:
            pass
    try:
        await invalidate_latest_cache(group_id)
    except Exception:
        pass
    try:
        await local_cache.delete_prefix(f"messages:page:{group_id}:")
    except Exception:
        pass
    try:
        await publish_invalidate(f"messages:page:{group_id}:")
    except Exception:
        pass
    return {"checked": checked, "updated": updated}


async def edit_group_message(
    db,
    group_id: str,
    message_id: str,
    body: MessageEditRequest,
) -> Dict[str, Any]:
    new_text = body.new_text
    if not new_text:
        raise HTTPException(status_code=400, detail="newText required")
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        }
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    now = _now_iso()
    edits = list(doc.get("edits") or [])
    edits.append({"previousText": doc.get("text", ""), "editedAt": now})
    await db[GROUP_MESSAGES_COLLECTION].update_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        },
        {"$set": {"text": new_text, "edited": True, "lastEditedAt": now, "edits": edits}},
    )
    try:
        await db["read_messages_latest"].update_one(
            {"groupId": group_id, "items.messageId": message_id},
            {
                "$set": {
                    "items.$.text": new_text,
                    "items.$.edited": True,
                    "items.$.lastEditedAt": now,
                }
            },
        )
    except Exception:
        pass
    try:
        await invalidate_latest_cache(group_id)
    except Exception:
        pass
    try:
        await local_cache.delete_prefix(f"messages:page:{group_id}:")
    except Exception:
        pass
    try:
        await publish_invalidate(f"messages:page:{group_id}:")
    except Exception:
        pass
    try:
        await local_cache.delete_prefix("groups:list:")
    except Exception:
        pass
    try:
        await publish_invalidate("groups:list:")
    except Exception:
        pass
    return {"success": True, "lastEditedAt": now, "edited": True}


async def delete_group_message(
    db,
    group_id: str,
    message_id: str,
) -> Dict[str, Any]:
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        }
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    now = _now_iso()
    now_ms = int(time.time() * 1000)
    await db[GROUP_MESSAGES_COLLECTION].update_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        },
        {
            "$set": {"deleted": True, "deletedAt": now, "text": ""},
            "$unset": {"media": "", "audio": ""},
        },
    )
    try:
        reply_filter = {
            "$or": [
                {"replyTo.messageId": message_id},
            ]
        }
        await db[GROUP_MESSAGES_COLLECTION].update_many(
            reply_filter,
            {
                "$set": {
                    "replyTo.deleted": True,
                    "replyTo.deletedAt": now,
                    "replyTo.text": "",
                },
            },
        )
    except Exception:
        pass
    try:
        result = await db["read_messages_latest"].update_one(
            {"groupId": group_id, "items.messageId": message_id},
            {
                "$set": {
                    "items.$[msg].deleted": True,
                    "items.$[msg].deletedAt": now,
                    "items.$[msg].text": "",
                    "updatedAt": now_ms,
                },
                "$unset": {
                    "items.$[msg].media": "",
                    "items.$[msg].audio": "",
                },
            },
            array_filters=[{"msg.messageId": message_id}],
        )
        if hasattr(result, "modified_count") and result.modified_count == 0:
            doc_rm = await db["read_messages_latest"].find_one(
                {"groupId": group_id}, {"_id": 0, "items": 1}
            )
            items = (doc_rm or {}).get("items") or []
            changed = False
            updated_items = []
            for item in items:
                if item.get("messageId") == message_id:
                    mod = dict(item)
                    mod["deleted"] = True
                    mod["deletedAt"] = now
                    mod["text"] = ""
                    mod.pop("media", None)
                    mod.pop("audio", None)
                    updated_items.append(mod)
                    changed = True
                else:
                    updated_items.append(item)
            if changed:
                await db["read_messages_latest"].update_one(
                    {"groupId": group_id},
                    {"$set": {"items": updated_items, "updatedAt": now_ms}},
                )
    except Exception:
        pass
    try:
        doc_rm = await db["read_messages_latest"].find_one(
            {"groupId": group_id},
            {"_id": 0, "items": 1},
        )
        items = (doc_rm or {}).get("items") or []
        if items:
            changed = False
            updated_items = []
            msg_ts = doc.get("timestamp")
            msg_user = doc.get("username")
            for item in items:
                reply = item.get("replyTo") if isinstance(item, dict) else None
                needs_update = False
                if isinstance(reply, dict):
                    if reply.get("messageId") == message_id:
                        needs_update = True
                    elif msg_ts and msg_user:
                        if (
                            reply.get("timestamp") == msg_ts
                            and reply.get("username") == msg_user
                        ):
                            needs_update = True
                if needs_update:
                    mod_item = dict(item)
                    new_reply = dict(reply or {})
                    new_reply["deleted"] = True
                    new_reply["deletedAt"] = now
                    new_reply["text"] = ""
                    new_reply.pop("media", None)
                    new_reply.pop("audio", None)
                    mod_item["replyTo"] = new_reply
                    updated_items.append(mod_item)
                    changed = True
                else:
                    updated_items.append(item)
            if changed:
                await db["read_messages_latest"].update_one(
                    {"groupId": group_id},
                    {"$set": {"items": updated_items, "updatedAt": now_ms}},
                )
    except Exception:
        pass
    try:
        await invalidate_latest_cache(group_id)
    except Exception:
        pass
    try:
        await local_cache.delete_prefix(f"messages:page:{group_id}:")
    except Exception:
        pass
    try:
        await publish_invalidate(f"messages:page:{group_id}:")
    except Exception:
        pass
    try:
        await local_cache.delete_prefix("groups:list:")
    except Exception:
        pass
    try:
        await publish_invalidate("groups:list:")
    except Exception:
        pass

    return {"success": True, "deletedAt": now}


async def react_to_group_message(
    db,
    group_id: str,
    message_id: str,
    body: MessageReactionRequest,
) -> Dict[str, Any]:
    emoji = body.emoji
    user = body.user or {}
    user_id = user.get("userId") if isinstance(user, dict) else None
    username = user.get("username") if isinstance(user, dict) else None
    if not user_id:
        raise HTTPException(status_code=400, detail="user.userId required")
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        }
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
    await db[GROUP_MESSAGES_COLLECTION].update_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        },
        {"$set": {"reactions": reactions}},
    )
    try:
        await invalidate_latest_cache(group_id)
    except Exception:
        pass
    try:
        await local_cache.delete_prefix(f"messages:page:{group_id}:")
    except Exception:
        pass
    try:
        await publish_invalidate(f"messages:page:{group_id}:")
    except Exception:
        pass
    summary = summarize_reactions(reactions)
    return {
        "success": True,
        "messageId": message_id,
        "reactions": reactions,
        "summary": summary.dict(by_alias=True),
    }


def build_etag(payload: Any) -> Optional[str]:
    try:
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    except Exception:
        return None
    return weak_etag(raw)


__all__ = [
    "LATEST_CACHE_TTL",
    "invalidate_latest_cache",
    "summarize_reactions",
    "resolve_reply_reference",
    "sanitize_message",
    "get_latest_messages",
    "get_inbox_previews",
    "create_group_message",
    "get_recordings_by_user",
    "backfill_replies",
    "edit_group_message",
    "delete_group_message",
    "react_to_group_message",
    "build_etag",
]
