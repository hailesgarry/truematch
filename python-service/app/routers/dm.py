from fastapi import APIRouter, HTTPException, Request, Response
from typing import Dict, List, Optional
from ..db import get_db
import uuid
import time
from .messages import (
    _sanitize_message as _sanitize_group_like,  # reuse behavior for reactions default
    _resolve_reply_ref,
)
from ..collections import DM_MESSAGES_COLLECTION
from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..utils.http import weak_etag
import json

router = APIRouter() 


def _sanitize(doc: Dict) -> Dict:
    if not doc:
        return doc
    doc = dict(doc)
    doc.pop("_id", None)
    if "reactions" not in doc or not isinstance(doc["reactions"], dict):
        doc["reactions"] = {}
    return doc


def summarize_reactions(reactions: Dict) -> Dict:
    entries = list((reactions or {}).values())
    if not entries:
        return {"totalCount": 0, "mostRecent": None}
    most = max(entries, key=lambda e: int(e.get("at", 0)))
    return {
        "totalCount": len(entries),
        "mostRecent": {
            "emoji": most.get("emoji"),
            "at": most.get("at"),
            "userId": most.get("userId"),
            "username": most.get("username"),
        },
    }

def _etag_for(payload: str) -> str:
    return weak_etag(payload)

def _dm_participants(dm_id: str) -> List[str]:
    try:
        rest = str(dm_id or "")[3:]
        parts = sorted([p.strip().lower() for p in rest.split("|") if p.strip()])
        return parts if len(parts) == 2 else []
    except Exception:
        return []


@router.get("/dm/{dm_id}/latest")
async def dm_latest(dm_id: str, count: Optional[int] = 100, request: Request = None, response: Response = None) -> List[Dict]:
    db = get_db()
    n = max(1, min(int(count or 100), 500))
    key = f"dm:latest:{dm_id}:{n}"
    inm = request.headers.get("if-none-match") if request else None
    hit = await local_cache.get(key)
    if hit is not None:
        if response is not None:
            try:
                raw = json.dumps(hit, separators=(",", ":"), sort_keys=True)
                response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
                tag = _etag_for(raw)
                response.headers["ETag"] = tag
                if inm and inm == tag:
                    response.status_code = 304
                    return []
            except Exception:
                pass
        return hit
    cur = db[DM_MESSAGES_COLLECTION].find({"dmId": dm_id}).sort("createdAt", 1).limit(n)
    out: List[Dict] = []
    async for x in cur:
        doc = _sanitize(x)
        rt = doc.get("replyTo")
        if isinstance(rt, dict):
            t = rt.get("text")
            if not isinstance(t, str) or t.strip() == "":
                # try to pull original by id/ts in same dmId
                # We can re-use resolver by treating dmId as group_id key
                enriched = await _resolve_reply_ref(db, dm_id, rt, collection_name=DM_MESSAGES_COLLECTION)
                doc["replyTo"] = enriched
        out.append(doc)
    await local_cache.set(key, out, ttl_seconds=15)
    if response is not None:
        try:
            raw = json.dumps(out, separators=(",", ":"), sort_keys=True)
            response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
            response.headers["ETag"] = _etag_for(raw)
        except Exception:
            pass
    return out


@router.post("/dm/{dm_id}/message")
async def dm_send(dm_id: str, payload: Dict) -> Dict:
    db = get_db()
    import datetime as _dt
    ts = _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc).isoformat()
    mid = str(uuid.uuid4())
    # Sanitize/resolve replyTo if provided
    incoming_rt = payload.get("replyTo") if isinstance(payload.get("replyTo"), dict) else None
    loose_ref = None
    if not incoming_rt:
        rid = payload.get("replyToMessageId")
        rts = payload.get("replyToTimestamp")
        if rid or rts:
            loose_ref = {k: v for k, v in ([("messageId", rid), ("timestamp", rts)]) if v}
    merged_ref = {**(loose_ref or {}), **(incoming_rt or {})} if (incoming_rt or loose_ref) else None
    reply_ref = await _resolve_reply_ref(db, dm_id, merged_ref, collection_name=DM_MESSAGES_COLLECTION)

    doc = {
        "dmId": dm_id,
        "messageId": mid,
        "timestamp": ts,
        "createdAt": int(time.time() * 1000),
        # author
        "userId": payload.get("userId"),
        "username": payload.get("username"),
        "avatar": payload.get("avatar"),
        "bubbleColor": payload.get("bubbleColor"),
        # content
    "text": str(payload.get("text", "")),
        "kind": payload.get("kind"),
        "media": payload.get("media"),
    "replyTo": reply_ref,
        # meta
        "edited": False,
        "lastEditedAt": None,
        "edits": [],
        "deleted": False,
        "deletedAt": None,
        "reactions": {},
    }
    # Store in the same collection as group messages for simplicity
    doc_room = { **doc, "roomId": dm_id, "groupId": dm_id }
    await db[DM_MESSAGES_COLLECTION].insert_one(doc_room)
    # Invalidate DM caches across instances
    try:
        await local_cache.delete_prefix(f"dm:latest:{dm_id}:")
        await publish_invalidate(f"dm:latest:{dm_id}:")
        await local_cache.delete_prefix(f"dm:page:{dm_id}:")
        await publish_invalidate(f"dm:page:{dm_id}:")
        # Invalidate thread listings for involved users
        for u in _dm_participants(dm_id):
            await local_cache.delete_prefix(f"dm:threads:{u}")
            await publish_invalidate(f"dm:threads:{u}")
    except Exception:
        pass
    return _sanitize(doc_room)


@router.put("/dm/{dm_id}/{message_id}")
async def dm_edit(dm_id: str, message_id: str, body: Dict) -> Dict:
    db = get_db()
    new_text = body.get("newText")
    if not new_text:
        raise HTTPException(status_code=400, detail="newText required")
    doc = await db[DM_MESSAGES_COLLECTION].find_one({"dmId": dm_id, "messageId": message_id})
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


@router.delete("/dm/{dm_id}/{message_id}")
async def dm_delete(dm_id: str, message_id: str) -> Dict:
    db = get_db()
    doc = await db[DM_MESSAGES_COLLECTION].find_one({"dmId": dm_id, "messageId": message_id})
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

    # Flag any replies in this DM that referenced the deleted message
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


@router.post("/dm/{dm_id}/{message_id}/reactions")
async def dm_react(dm_id: str, message_id: str, body: Dict) -> Dict:
    db = get_db()
    emoji = body.get("emoji")
    user = body.get("user") or {}
    user_id = user.get("userId")
    username = user.get("username")
    if not user_id:
        raise HTTPException(status_code=400, detail="user.userId required")
    doc = await db[DM_MESSAGES_COLLECTION].find_one({"dmId": dm_id, "messageId": message_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    reactions = dict(doc.get("reactions") or {})
    current = (reactions.get(user_id) or {}).get("emoji")
    now_ms = int(time.time() * 1000)
    if not emoji or (isinstance(emoji, str) and emoji.strip() == "") or current == emoji:
        reactions.pop(user_id, None)
    else:
        reactions[user_id] = {"emoji": emoji, "at": now_ms, "userId": user_id, "username": username}
    await db[DM_MESSAGES_COLLECTION].update_one(
        {"dmId": dm_id, "messageId": message_id}, {"$set": {"reactions": reactions}}
    )
    try:
        await local_cache.delete_prefix(f"dm:latest:{dm_id}:")
        await publish_invalidate(f"dm:latest:{dm_id}:")
        await local_cache.delete_prefix(f"dm:page:{dm_id}:")
        await publish_invalidate(f"dm:page:{dm_id}:")
    except Exception:
        pass
    return {
        "success": True,
        "messageId": message_id,
        "reactions": reactions,
        "summary": summarize_reactions(reactions),
    }


@router.get("/dm/threads")
async def dm_threads(user: str, request: Request = None, response: Response = None) -> Dict:
    """Return DM thread metadata for a user, including a lightweight preview message."""
    db = get_db()
    u = (user or "").strip().lower()
    if not u:
        return {"threads": []}

    key = f"dm:threads:{u}"
    inm = request.headers.get("if-none-match") if request else None
    hit = await local_cache.get(key)
    if hit is not None:
        if response is not None:
            try:
                raw = json.dumps(hit, separators=(",", ":"), sort_keys=True)
                response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
                tag = _etag_for(raw)
                response.headers["ETag"] = tag
                if inm and inm == tag:
                    response.status_code = 304
                    return {}
            except Exception:
                pass
        return hit

    # Fetch the latest message per DM (sorted newest first) so we can include previews.
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
    threads: List[Dict] = []

    async for row in cur:
        dm_id = row.get("_id")
        rest = str(dm_id or "")[3:]
        parts = sorted([p.strip().lower() for p in rest.split("|") if p.strip()])
        if len(parts) != 2 or u not in parts:
            continue

        preview: Optional[Dict] = None
        last_doc = row.get("last")
        if isinstance(last_doc, dict):
            preview = _sanitize(last_doc)
            if preview is not None:
                preview.pop("roomId", None)
                preview.pop("groupId", None)
                preview.pop("dmId", None)
                rt = preview.get("replyTo")
                if isinstance(rt, dict):
                    try:
                        preview["replyTo"] = await _resolve_reply_ref(db, dm_id, rt, collection_name=DM_MESSAGES_COLLECTION)
                    except Exception:
                        pass

        entry = {"dmId": dm_id, "latest": row.get("latest")}
        if preview:
            entry["last"] = preview
        threads.append(entry)

    out = {"threads": threads}
    await local_cache.set(key, out, ttl_seconds=10)
    if response is not None:
        try:
            raw = json.dumps(out, separators=(",", ":"), sort_keys=True)
            response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
            response.headers["ETag"] = _etag_for(raw)
        except Exception:
            pass
    return out

@router.get("/dm/{dm_id}/page")
async def dm_page(
    dm_id: str,
    before: Optional[int] = None,
    limit: Optional[int] = 50,
    request: Request = None,
    response: Response = None,
) -> Dict:
    db = get_db()
    n = max(1, min(int(limit or 50), 200))
    key = f"dm:page:{dm_id}:{n}:{int(before) if before is not None else 0}"
    inm = request.headers.get("if-none-match") if request else None
    hit = await local_cache.get(key)
    if hit is not None:
        if response is not None:
            try:
                raw = json.dumps(hit, separators=(",", ":"), sort_keys=True)
                response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
                tag = _etag_for(raw)
                response.headers["ETag"] = tag
                if inm and inm == tag:
                    response.status_code = 304
                    return {}
            except Exception:
                pass
        return hit

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
        "deleted": 1,
        "deletedAt": 1,
    }
    filt: Dict = {"dmId": dm_id}
    if before is not None:
        try:
            b = int(before)
            filt["createdAt"] = {"$lt": b}
        except Exception:
            pass
    cur = db[DM_MESSAGES_COLLECTION].find(filt, projection).sort("createdAt", -1).limit(n)
    page_desc: List[Dict] = []
    async for x in cur:
        page_desc.append(_sanitize(x))
        if len(page_desc) >= n:
            break
    page = list(reversed(page_desc))
    next_before = page[0]["createdAt"] if page else None
    if page:
        oldest = page[0]["createdAt"]
        try:
            more = await db[DM_MESSAGES_COLLECTION].count_documents({
                "$and": [
                    {"dmId": dm_id},
                    {"createdAt": {"$lt": oldest}},
                ]
            }, limit=1)
            next_before = oldest if more > 0 else None
        except Exception:
            older = await db[DM_MESSAGES_COLLECTION].find_one({
                "$and": [
                    {"dmId": dm_id},
                    {"createdAt": {"$lt": oldest}},
                ]
            })
            next_before = oldest if older else None
    out = {"items": page, "nextBefore": next_before}
    await local_cache.set(key, out, ttl_seconds=10)
    if response is not None:
        try:
            raw = json.dumps(out, separators=(",", ":"), sort_keys=True)
            response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
            response.headers["ETag"] = _etag_for(raw)
        except Exception:
            pass
    return out
