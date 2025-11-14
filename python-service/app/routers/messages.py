from fastapi import APIRouter, HTTPException, Response, Request
from typing import Any, Dict, List, Optional
from ..db import get_db
import uuid
import time
import os
import json
from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..redis_bus import publish as redis_publish
from ..redis_cache import (
    delete_prefix as redis_cache_delete_prefix,
    get as redis_cache_get,
    set as redis_cache_set,
)
from ..utils.http import weak_etag
from ..collections import GROUP_MESSAGES_COLLECTION, DM_MESSAGES_COLLECTION

router = APIRouter()


LATEST_CACHE_TTL = 15


async def _invalidate_latest_cache(group_id: str) -> None:
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


def now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().replace(tzinfo=_dt.timezone.utc).isoformat()


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


def _thread_scope_filter(scope_id: str, collection_name: str) -> Dict:
    clauses = []
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


async def _resolve_reply_ref(db, scope_id: str, ref: Dict, collection_name: str = GROUP_MESSAGES_COLLECTION) -> Optional[Dict]:
    """
    Ensure replyTo has username, text, and timestamp where possible.
    Accepts a snapshot like { messageId?, username?, text?, timestamp?, kind?, media? }.
    If text is missing but messageId/timestamp are present, look up the original message.
    """
    if not ref or not isinstance(ref, dict):
        return None

    collection = db[collection_name]
    scope_filter = _thread_scope_filter(scope_id, collection_name)

    # Start with the provided snapshot
    out = {
        k: v
        for k, v in ref.items()
        if k in {"messageId", "username", "text", "timestamp", "kind", "media", "audio", "deleted", "deletedAt"}
    }

    # If text is missing/empty, try to fetch the original
    needs_text = not isinstance(out.get("text"), str) or out.get("text", "").strip() == ""
    try:
        original = None
        if needs_text and ref.get("messageId"):
            original = await collection.find_one({
                "$and": [
                    {"messageId": ref["messageId"]},
                    scope_filter,
                ]
            })
        if needs_text and not original and ref.get("timestamp"):
            original = await collection.find_one({
                "$and": [
                    {"timestamp": ref["timestamp"]},
                    scope_filter,
                ]
            })
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
        # Non-fatal: keep snapshot as-is 
        pass

    # Final guard: ensure we store at least an empty string for text if it was a reply
    if "text" not in out or out["text"] is None:
        out["text"] = ""

    return out


def _sanitize_message(doc: Dict) -> Dict:
    if not doc:
        return doc
    doc = dict(doc)
    doc.pop("_id", None)
    # Ensure reactions always present
    if "reactions" not in doc or not isinstance(doc["reactions"], dict):
        doc["reactions"] = {}
    return doc


async def _get_message_doc(db, group_id: str, message_id: str, projection: Dict) -> Dict:
    """Fetch a single message scoped to the group with a lean projection."""
    query = {
        "$and": [
            {"messageId": message_id},
            {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
        ]
    }
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one(query, projection)
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    doc.pop("_id", None)
    return doc


def _etag_for(payload: str) -> str:
    # Backwards-compatible wrapper while migrating calls
    return weak_etag(payload)


def _derive_preview(doc: Dict) -> Dict:
    if not doc:
        return {}
    # Use common fields across group and dm docs 
    return {
        "username": doc.get("username"),
        "text": doc.get("text"),
        "kind": doc.get("kind"),
        "timestamp": doc.get("timestamp"),
        "media": doc.get("media"),
    }


def _parse_timestamp_to_ms(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        numeric = int(value)
        if numeric < 1_000_000_000_000:
            numeric *= 1000
        return numeric
    if isinstance(value, str):
        try:
            numeric = int(value)
        except (TypeError, ValueError):
            try:
                from datetime import datetime

                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return int(dt.timestamp() * 1000)
            except Exception:
                return None
        else:
            if numeric < 1_000_000_000_000:
                numeric *= 1000
            return numeric
    return None


@router.get("/messages/{group_id}/latest")
async def get_latest_messages(
    group_id: str,
    request: Request,
    response: Response,
    count: Optional[int] = 100,
) -> List[Dict[str, Any]]:
    """Return the most recent messages for a group ordered oldest -> newest."""
    db = get_db()
    n = max(1, min(int(count or 100), 500))
    cache_key = f"messages:latest:{group_id}:{n}"
    inm = None
    try:
        inm = request.headers.get("if-none-match")
    except Exception:
        inm = None

    cached = await local_cache.get(cache_key)
    if cached is None:
        redis_snapshot = await redis_cache_get(cache_key)
        if redis_snapshot is not None:
            cached = redis_snapshot
            try:
                await local_cache.set(cache_key, cached, ttl_seconds=LATEST_CACHE_TTL)
            except Exception:
                pass
    if cached is not None:
        try:
            raw = json.dumps(cached, separators=(",", ":"), sort_keys=True)
            response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
            tag = _etag_for(raw)
            response.headers["ETag"] = tag
            if inm and inm == tag:
                response.status_code = 304
                return []
        except Exception:
            pass
        return cached

    items: List[Dict[str, Any]] = []

    # Prefer the read model cache if populated (already ordered oldest -> newest)
    try:
        doc = await db["read_messages_latest"].find_one(
            {"groupId": group_id},
            {"_id": 0, "items": {"$slice": -int(n)}},
        )
        candidates = (doc or {}).get("items") or []
        if candidates:
            items = [
                _sanitize_message(message)
                for message in candidates[-n:]
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
            .limit(int(n))
        )
        latest_desc: List[Dict[str, Any]] = []
        async for doc in cursor:
            latest_desc.append(_sanitize_message(doc))
        latest_desc.reverse()
        items = latest_desc

    # Ensure reply snapshots include resolved text/media when missing
    enriched: List[Dict[str, Any]] = []
    for message in items:
        if not isinstance(message, dict):
            continue
        rt = message.get("replyTo")
        if isinstance(rt, dict):
            txt = rt.get("text")
            try:
                if not isinstance(txt, str) or txt.strip() == "":
                    resolved = await _resolve_reply_ref(
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

    await local_cache.set(cache_key, enriched, ttl_seconds=LATEST_CACHE_TTL)
    await redis_cache_set(cache_key, enriched, ttl_seconds=LATEST_CACHE_TTL)

    try:
        raw = json.dumps(enriched, separators=(",", ":"), sort_keys=True)
        tag = _etag_for(raw)
        response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
        response.headers["ETag"] = tag
        if inm and inm == tag:
            response.status_code = 304
            return []
    except Exception:
        pass

    return enriched


@router.get("/inbox/previews")
async def inbox_previews(request: Request, response: Response) -> Dict:
    """Return a compact list of latest message previews for many threads at once.

    Response shape: { previews: [{ threadId, username, text, kind, timestamp }, ...] }
    Includes group chats by groupId and DMs by dmId.
    """
    db = get_db()
    previews = []
    try:
      # Optional: filter groups by joined ids from a header (CSV)
      joined_csv = None
      try:
          joined_csv = request.headers.get("X-Joined-Groups")
      except Exception:
          joined_csv = None
      joined_ids = None
      if joined_csv:
          joined_ids = [s.strip() for s in str(joined_csv).split(",") if s.strip()]
      # Groups: list limited set; default limit 200 ids
      query = {"id": {"$in": joined_ids}} if joined_ids else {}
      groups_cur = db["groups"].find(query, {"_id": 0, "id": 1}).limit(200)
      group_ids = [g.get("id") async for g in groups_cur if g.get("id")]
      for gid in group_ids:
          latest = None
          try:
              doc = await db["read_messages_latest"].find_one({"groupId": gid}, {"_id": 0, "items": {"$slice": -1}})
              items = (doc or {}).get("items") or []
              latest = items[-1] if items else None
          except Exception:
              latest = None
          if not latest:
              # Fallback to messages newest by createdAt
              cur = db[GROUP_MESSAGES_COLLECTION].find({"groupId": gid}, {"_id": 0}).sort("createdAt", -1).limit(1)
              latest = await cur.to_list(length=1)
              latest = latest[0] if latest else None
          if latest:
              p = _derive_preview(latest)
              p["threadId"] = gid
              previews.append(p)

    # DMs: gather recent dmIds from messages collection (last 1000 docs)
      dm_latest = {}
      cur = db[DM_MESSAGES_COLLECTION].find({"dmId": {"$exists": True}}, {"_id": 0, "dmId": 1, "createdAt": 1, "username": 1, "text": 1, "kind": 1, "timestamp": 1}).sort("createdAt", -1).limit(1000)
      async for d in cur:
          dm_id = d.get("dmId")
          if not dm_id:
              continue
          # Keep the newest per dmId
          if dm_id in dm_latest:
              continue
          dm_latest[dm_id] = d
      for dm_id, doc in dm_latest.items():
          p = _derive_preview(doc)
          p["threadId"] = dm_id
          previews.append(p)
    except Exception:
      pass
    # ETag for cache friendliness
    try:
        raw = json.dumps({"previews": previews}, separators=(",", ":"), sort_keys=True)
        response.headers["Cache-Control"] = "public, max-age=5, stale-while-revalidate=15"
        response.headers["ETag"] = _etag_for(raw)
    except Exception:
        pass
    # Cap total previews to avoid runaway payloads
    try:
        previews = previews[:1000]
    except Exception:
        pass
    return {"previews": previews}


@router.post("/messages/{group_id}")
async def create_message(group_id: str, payload: Dict) -> Dict:
    db = get_db()
    ts = now_iso()
    mid = str(uuid.uuid4())
    # Sanitize/resolve replyTo if provided
    # Accept either a snapshot in payload.replyTo or loose keys replyToMessageId / replyToTimestamp
    incoming_rt = payload.get("replyTo") if isinstance(payload.get("replyTo"), dict) else None
    loose_ref = None
    if not incoming_rt:
        # Construct a minimal ref from loose fields, if present
        rid = payload.get("replyToMessageId")
        rts = payload.get("replyToTimestamp")
        if rid or rts:
            loose_ref = {k: v for k, v in ([("messageId", rid), ("timestamp", rts)]) if v}
    # Merge loose_ref into snapshot (snapshot wins for username/text/media/kind)
    merged_ref = None
    if incoming_rt and loose_ref:
        merged_ref = {**loose_ref, **incoming_rt}
    else:
        merged_ref = incoming_rt or loose_ref

    reply_ref = await _resolve_reply_ref(db, group_id, merged_ref)
    doc = {
        "roomId": group_id,
        "groupId": group_id,  # legacy compatibility
        "messageId": mid,
        "timestamp": ts,
        "createdAt": int(time.time() * 1000),
        # user info
        "userId": payload.get("userId"),
        "username": payload.get("username"),
        "avatar": payload.get("avatar"),
        "bubbleColor": payload.get("bubbleColor"),
        # content
        "text": str(payload.get("text", "")),
        "kind": payload.get("kind"),
        "media": payload.get("media"),
        "audio": payload.get("audio"),
        "replyTo": reply_ref,
        # flags/meta
        "edited": False,
        "lastEditedAt": None,
        "edits": [],
        "deleted": False,
        "deletedAt": None,
        # reactions map keyed by userId
        "reactions": {},
    }
    await db[GROUP_MESSAGES_COLLECTION].insert_one(doc)
    # Publish domain event (best-effort, non-blocking)
    try:
        await redis_publish("messages", {
            "type": "message_created",
            "groupId": group_id,
            "messageId": mid,
            "createdAt": doc["createdAt"],
            "username": doc.get("username"),
            "userId": doc.get("userId"),
            "text": doc.get("text"),
        })
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
        await _invalidate_latest_cache(group_id)
    except Exception:
        pass
    return _sanitize_message(doc)

@router.get("/users/{username}/recordings")
async def get_recordings_by_user(username: str, limit: int = 50, groupId: str | None = None) -> Dict:
    """Return recent voice recordings (kind == 'audio') by username.

    Optional groupId filters to a specific group. Case-insensitive username match.
    Response: { items: [{ messageId, groupId, timestamp, audio, createdAt }...] }
    """
    db = get_db()
    n = max(1, min(int(limit or 50), 200))
    uname = (username or "").strip().lower()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    filt = {
        "$and": [
            {"kind": "audio"},
            {"$expr": {"$eq": [{"$toLower": "$username"}, uname]}},
        ]
    }
    if groupId:
        filt["$and"].append({"$or": [{"groupId": groupId}, {"roomId": groupId}]})
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
    items: list[Dict] = []
    cur = db[GROUP_MESSAGES_COLLECTION].find(filt, projection).sort("createdAt", -1).limit(n)
    async for d in cur:
        items.append(_sanitize_message(d))
    return {"items": items}


@router.post("/messages/{group_id}/backfill-replies")
async def backfill_replies(group_id: str, limit: Optional[int] = 200) -> Dict:
    """Populate missing replyTo.text for recent messages. Idempotent and safe for dev.
    Default limit scans the latest 200 messages in the room.
    """
    db = get_db()
    n = max(1, min(int(limit or 200), 1000))
    # Get latest n by createdAt descending
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
        # resolve
        enriched = await _resolve_reply_ref(db, group_id, rt)
        try:
            await db[GROUP_MESSAGES_COLLECTION].update_one(
                {"_id": doc["_id"]}, {"$set": {"replyTo": enriched}}
            )
            updated += 1
        except Exception:
            # non-fatal
            pass
    try:
        await _invalidate_latest_cache(group_id)
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


@router.put("/messages/{group_id}/{message_id}")
async def edit_message(group_id: str, message_id: str, body: Dict) -> Dict:
    db = get_db()
    new_text = body.get("newText")
    if not new_text:
        raise HTTPException(status_code=400, detail="newText required")
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one({
        "$and": [
            {"messageId": message_id},
            {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
        ]
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    now = now_iso()
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
    # Update denormalized latest window cache in Mongo so refreshes reflect edits
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
    # Bust hot caches so subsequent fetches pull the updated payload
    try:
        await _invalidate_latest_cache(group_id)
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
    # Pub/sub removed
    return {"success": True, "lastEditedAt": now, "edited": True}


@router.delete("/messages/{group_id}/{message_id}")
async def delete_message(group_id: str, message_id: str) -> Dict:
    db = get_db()
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one({
        "$and": [
            {"messageId": message_id},
            {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
        ]
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    now = now_iso()
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

    # Propagate deletion signal to any replies referencing this message
    try:
        reply_filter = {
            "$or": [
                {"replyTo.messageId": message_id},
            ]
        }
        msg_ts = doc.get("timestamp")
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

    # Keep read model in sync so refreshes reflect deletions immediately
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
        # If the positional update was unsupported (older Mongo), fall back to manual rewrite
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
        # Best-effort only: inconsistencies will self-heal on next create/backfill
        pass

    # Ensure reply snapshots in read model hide deleted media
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

    # Bust hot caches so clients don't see stale media after refresh
    try:
        await _invalidate_latest_cache(group_id)
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


@router.post("/messages/{group_id}/{message_id}/reactions")
async def react_message(group_id: str, message_id: str, body: Dict) -> Dict:
    db = get_db()
    emoji = body.get("emoji")
    user = body.get("user") or {}
    user_id = user.get("userId")
    username = user.get("username")
    if not user_id:
        raise HTTPException(status_code=400, detail="user.userId required")
    doc = await db[GROUP_MESSAGES_COLLECTION].find_one({
        "$and": [
            {"messageId": message_id},
            {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
        ]
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = dict(doc.get("reactions") or {})
    current = (reactions.get(user_id) or {}).get("emoji")
    now_ms = int(time.time() * 1000)
    if not emoji or (isinstance(emoji, str) and emoji.strip() == "") or current == emoji:
        # toggle off
        reactions.pop(user_id, None)
    else:
        reactions[user_id] = {"emoji": emoji, "at": now_ms, "userId": user_id, "username": username}
    await db[GROUP_MESSAGES_COLLECTION].update_one(
        {
            "$and": [
                {"messageId": message_id},
                {"$or": [{"roomId": group_id}, {"groupId": group_id}]},
            ]
        },
        {"$set": {"reactions": reactions}}
    )
    try:
        await _invalidate_latest_cache(group_id)
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
    return {
        "success": True,
        "messageId": message_id,
        "reactions": reactions,
        "summary": summarize_reactions(reactions),
    }


