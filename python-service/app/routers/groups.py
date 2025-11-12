from fastapi import APIRouter, HTTPException, Response, Request
from typing import Any, Dict, List, Optional
from datetime import datetime
import os
import httpx
from fastapi import Query
import time
from bson import ObjectId
from ..db import get_db
from ..cache import cache as local_cache
from ..utils.http import weak_etag
from ..cache_bus import publish_invalidate
from ..collections import GROUP_MESSAGES_COLLECTION
import json

_ROSTER_PREVIEW_LIMIT_DEFAULT = 5
_ROSTER_PREVIEW_LIMIT_MAX = 10
_ROSTER_PREVIEW_TTL = int(os.getenv("GROUP_ROSTER_PREVIEW_TTL", "30"))


def _roster_cache_key(group_id: str, limit: int) -> str:
    return f"roster-preview:{group_id}:{limit}"


def _sanitize_preview_member(item: Dict[str, Any]) -> Dict[str, Optional[str]]:
    username = (item.get("username") or "").strip()
    avatar = item.get("avatar")
    if isinstance(avatar, str):
        avatar = avatar.strip() or None
    user_id = item.get("userId")
    if isinstance(user_id, str):
        user_id = user_id.strip() or None
    return {
        "username": username,
        "avatar": avatar if avatar else None,
        "userId": user_id if user_id else None,
    }


async def _fetch_member_preview(db, group_ids: List[str], limit: int) -> Dict[str, Dict[str, Any]]:
    unique_ids = []
    seen = set()
    for raw in group_ids:
        gid = (raw or "").strip()
        if not gid or gid in seen:
            continue
        seen.add(gid)
        unique_ids.append(gid)

    if not unique_ids:
        return {}

    cached_results: Dict[str, Dict[str, Any]] = {}
    uncached_ids: List[str] = []
    for gid in unique_ids:
        cached = await local_cache.get(_roster_cache_key(gid, limit))
        if cached is not None:
            cached_results[gid] = cached
        else:
            uncached_ids.append(gid)

    if uncached_ids:
        pipeline = [
            {"$match": {"groupId": {"$in": uncached_ids}}},
            {
                "$lookup": {
                    "from": "profiles",
                    "let": {"uname": "$usernameLower"},
                    "pipeline": [
                        {
                            "$match": {
                                "$expr": {"$eq": ["$usernameLower", "$$uname"]}
                            }
                        },
                        {
                            "$project": {
                                "_id": 0,
                                "avatarUrl": "$avatarUrl",
                                "userId": "$userId",
                            }
                        },
                    ],
                    "as": "profile",
                }
            },
            {
                "$addFields": {
                    "profile": {
                        "$cond": [
                            {"$isArray": "$profile"},
                            {"$arrayElemAt": ["$profile", 0]},
                            None,
                        ]
                    }
                }
            },
            {"$match": {"profile": {"$ne": None}}},
            {
                "$project": {
                    "_id": 0,
                    "groupId": 1,
                    "username": "$username",
                    "usernameLower": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$ne": ["$usernameLower", None]},
                                    {"$ne": ["$usernameLower", ""]},
                                ]
                            },
                            "$usernameLower",
                            {"$toLower": {"$ifNull": ["$username", ""]}},
                        ]
                    },
                    "avatar": "$profile.avatarUrl",
                    "userId": "$profile.userId",
                    "joinedAt": {"$ifNull": ["$joinedAt", 0]},
                }
            },
            {"$sort": {"joinedAt": -1, "usernameLower": 1}},
            {
                "$group": {
                    "_id": {
                        "groupId": "$groupId",
                        "usernameLower": "$usernameLower",
                    },
                    "groupId": {"$first": "$groupId"},
                    "username": {"$first": "$username"},
                    "avatar": {"$first": "$avatar"},
                    "userId": {"$first": "$userId"},
                    "joinedAt": {"$first": "$joinedAt"},
                }
            },
            {"$sort": {"joinedAt": -1, "username": 1}},
            {
                "$group": {
                    "_id": "$groupId",
                    "total": {"$sum": 1},
                    "members": {
                        "$push": {
                            "username": "$username",
                            "avatar": "$avatar",
                            "userId": "$userId",
                        }
                    },
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "groupId": "$_id",
                    "total": 1,
                    "members": {"$slice": ["$members", limit]},
                }
            },
        ]

        docs = await db["group_members"].aggregate(pipeline).to_list(
            length=len(uncached_ids) * max(limit, 1) * 2
        )

        for doc in docs:
            gid = doc.get("groupId")
            if not gid:
                continue
            members = [
                _sanitize_preview_member(m)
                for m in doc.get("members", [])
                if isinstance(m, dict)
            ]
            payload = {
                "total": int(doc.get("total") or 0),
                "members": members,
            }
            cached_results[gid] = payload
            await local_cache.set(
                _roster_cache_key(gid, limit), payload, _ROSTER_PREVIEW_TTL
            )

        for gid in uncached_ids:
            if gid not in cached_results:
                empty = {"total": 0, "members": []}
                cached_results[gid] = empty
                await local_cache.set(
                    _roster_cache_key(gid, limit), empty, _ROSTER_PREVIEW_TTL
                )

    return cached_results


_IMAGE_EXTS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".avif",
    ".heic",
    ".heif",
    ".bmp",
)

_VIDEO_EXTS = (
    ".mp4",
    ".webm",
    ".mov",
    ".m4v",
    ".mkv",
    ".avi",
    ".3gp",
    ".3gpp",
)


def _looks_like_image(url: Optional[str]) -> bool:
    if not url or not isinstance(url, str):
        return False
    lower = url.strip().lower()
    if lower.startswith("data:image/"):
        return True
    if "/image/upload/" in lower:
        return True
    base = lower.split("?", 1)[0].split("#", 1)[0]
    return any(base.endswith(ext) for ext in _IMAGE_EXTS)


def _looks_like_video(url: Optional[str]) -> bool:
    if not url or not isinstance(url, str):
        return False
    lower = url.strip().lower()
    if lower.startswith("data:video/"):
        return True
    if "/video/upload/" in lower:
        return True
    base = lower.split("?", 1)[0].split("#", 1)[0]
    return any(base.endswith(ext) for ext in _VIDEO_EXTS)


def _collect_media_urls(media: Any) -> List[str]:
    if not isinstance(media, dict):
        return []
    urls: List[str] = []
    for key in ("original", "preview", "placeholder", "mp4", "webm", "gif", "url"):
        value = media.get(key)
        if isinstance(value, str) and value.strip():
            urls.append(value.strip())
    variants = media.get("variants")
    if isinstance(variants, dict):
        for val in variants.values():
            if isinstance(val, str) and val.strip():
                urls.append(val.strip())
    return urls


def _classify_media(media: Any) -> Optional[str]:
    urls = _collect_media_urls(media)
    if not urls:
        return None
    if any(_looks_like_video(url) for url in urls):
        return "video"
    if any(_looks_like_image(url) for url in urls):
        return "photo"
    return "attachment"


def _to_millis(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        numeric = int(value)
        if numeric < 1_000_000_000_000:
            numeric *= 1000
        return numeric
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            numeric = int(raw)
        except ValueError:
            try:
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                return int(dt.timestamp() * 1000)
            except Exception:
                return None
        if numeric < 1_000_000_000_000:
            numeric *= 1000
        return numeric
    return None


def _coerce_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return int(float(raw))
        except ValueError:
            return None
    return None


def _build_preview(message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(message, dict):
        return None
    if message.get("deleted"):
        return None
    if message.get("system") is True:
        return None
    system_type = message.get("systemType")
    if isinstance(system_type, str) and system_type.strip():
        return None

    username = message.get("username")
    text = message.get("text") if isinstance(message.get("text"), str) else ""
    kind = message.get("kind") if isinstance(message.get("kind"), str) else None

    voice_note = False
    audio = message.get("audio") if isinstance(message.get("audio"), dict) else None
    audio_duration = None
    if audio:
        url = audio.get("url") or audio.get("src")
        if isinstance(url, str) and url.strip():
            voice_note = True
        duration = audio.get("durationMs") or audio.get("duration")
        audio_duration = _coerce_int(duration)

    media = message.get("media") if isinstance(message.get("media"), dict) else None
    media_type = _classify_media(media) if media else None
    has_media = bool(media_type)

    preview_text = text.strip()
    if kind == "gif":
        preview_text = "GIF"
    elif has_media:
        if media_type == "photo":
            preview_text = "Photo"
        elif media_type == "video":
            preview_text = "Video"
        else:
            preview_text = "Attachment"
    elif not preview_text and voice_note:
        preview_text = ""

    created_at = _to_millis(message.get("createdAt") or message.get("timestamp"))
    timestamp = message.get("timestamp") if isinstance(message.get("timestamp"), str) else None

    return {
        "username": username if isinstance(username, str) else None,
        "text": text or "",
        "previewText": preview_text or None,
        "voiceNote": bool(voice_note),
        "kind": kind,
        "createdAt": created_at,
        "timestamp": timestamp,
        "hasMedia": has_media,
        "mediaType": media_type,
        "audioDurationMs": audio_duration,
    }


async def _fetch_latest_message_previews(db, group_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    previews: Dict[str, Dict[str, Any]] = {}
    if not group_ids:
        return previews

    try:
        cursor = db["read_messages_latest"].find(
            {"groupId": {"$in": group_ids}},
            {"_id": 0, "groupId": 1, "items": {"$slice": -5}},
        )
        async for doc in cursor:
            gid = doc.get("groupId")
            if not gid or gid in previews:
                continue
            items = doc.get("items") or []
            chosen = None
            for candidate in reversed(items):
                preview = _build_preview(candidate)
                if preview:
                    chosen = preview
                    break
            if chosen:
                previews[gid] = chosen
    except Exception:
        pass

    remaining = [gid for gid in group_ids if gid not in previews]
    if not remaining:
        return previews

    try:
        cursor = db[GROUP_MESSAGES_COLLECTION].find(
            {"groupId": {"$in": remaining}},
            {"_id": 0},
        ).sort("createdAt", -1).limit(len(remaining) * 20)
        async for doc in cursor:
            gid = doc.get("groupId") or doc.get("roomId")
            if not gid or gid in previews:
                continue
            preview = _build_preview(doc)
            if preview:
                previews[gid] = preview
            if len(previews) == len(group_ids):
                break
    except Exception:
        pass

    return previews
def _is_reserved_username(name: str) -> bool:
    n = (name or "").strip().lower()
    return n in {"system", "_system"}



def _clean_group(doc: Dict) -> Dict:
    if not doc:
        return doc
    data = dict(doc)
    oid = data.pop("_id", None)
    if oid is not None:
        try:
            data["databaseId"] = str(oid)
        except Exception:
            pass
        else:
            # Ensure callers have a usable id even when legacy "id" is absent
            if not data.get("id"):
                data["id"] = data["databaseId"]
    if data.get("id") and "slug" not in data:
        data["slug"] = data["id"]
    elif data.get("databaseId") and "slug" not in data:
        data["slug"] = data["databaseId"]
    if "description" not in data or data["description"] is None:
        data["description"] = ""
    if "onlineCount" not in data:
        data["onlineCount"] = 0
    return data


def _maybe_object_id(raw: str) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except Exception:
        return None


async def _find_group(db, group_id: str) -> Optional[Dict]:
    if not group_id:
        return None
    doc = await db["groups"].find_one({"id": group_id})
    if doc:
        return doc
    oid = _maybe_object_id(group_id)
    if oid is not None:
        return await db["groups"].find_one({"_id": oid})
    return None

router = APIRouter()

# Reuse a single AsyncClient to avoid repeated TCP/TLS setup overhead
_http_client: Optional[httpx.AsyncClient] = None

async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=3.0)
    return _http_client

def _etag_for(payload: str) -> str:
    return weak_etag(payload)

async def warm_groups_cache() -> None:
    """Pre-populate groups list local cache for faster first request.

    Safe to call at startup; ignores errors and proceeds silently.
    """
    try:
        db = get_db()
        docs = await db["groups"].find({}, {"_id": 0, "id": 1, "name": 1, "description": 1, "avatarUrl": 1}).to_list(length=1000)
        groups = [_clean_group(d) for d in docs]
        # Only local cache now
        await local_cache.set("groups:list:0", groups, ttl_seconds=30)
    except Exception:
        # Warmup is best-effort; ignore errors
        pass

# --- Presence stubs (compat with legacy Node service) ---

_presence_cache: Dict[str, Dict] = {}
_presence_cache_expiry: Dict[str, float] = {}
_ONLINE_COUNTS_KEY = "online-counts"
_ONLINE_COUNTS_TTL = float(os.getenv("ONLINE_COUNTS_TTL", "5"))  # seconds
_REDIS_ENABLED = False

# Simple Prometheus counters (manual; integrate with real lib later)
_metrics = {
    "presence_timeouts": 0,
    "presence_requests": 0,
}

def prom_metrics_text() -> str:
    return (
        f"# HELP presence_timeouts Total presence proxy timeouts\n"
        f"# TYPE presence_timeouts counter\n"
        f"presence_timeouts {_metrics['presence_timeouts']}\n"
        f"# HELP presence_requests Total presence proxy requests\n"
        f"# TYPE presence_requests counter\n"
        f"presence_requests {_metrics['presence_requests']}\n"
    )

async def _fetch_online_counts() -> Dict[str, int]:
    """Internal helper to proxy online counts from the legacy Node service."""
    now = time.time()
    cached = _presence_cache.get(_ONLINE_COUNTS_KEY)
    if cached and _presence_cache_expiry.get(_ONLINE_COUNTS_KEY, 0) > now:
        return cached
    node_url = os.getenv("API_URL", "http://localhost:8080/api").rstrip("/")
    url = f"{node_url}/groups/online-counts"
    _metrics["presence_requests"] += 1
    try:
        client = await _get_http_client()
        r = await client.get(url, timeout=2.0)
        r.raise_for_status()
        data = r.json() or {}
        clean = {str(k): int(v) for k, v in data.items()}
        _presence_cache[_ONLINE_COUNTS_KEY] = clean
        _presence_cache_expiry[_ONLINE_COUNTS_KEY] = now + _ONLINE_COUNTS_TTL
        return clean
    except httpx.TimeoutException:
        _metrics["presence_timeouts"] += 1
        return {}
    except Exception:
        return {}


# ---------------- Membership management (explicit) ----------------

@router.post("/groups/{group_id}/members")
async def add_group_member(group_id: str, body: Dict) -> Dict:
    """Add or update an explicit group member.
    Body: { username: string, role?: string, joinedAt?: int }
    """
    db = get_db()
    username = str(body.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="username required")
    role = str(body.get("role") or "member").strip() or "member"
    joined_at = int(body.get("joinedAt") or int(time.time() * 1000))
    doc = {
        "groupId": group_id,
        "username": username,
        "usernameLower": username.lower(),
        "role": role,
        "joinedAt": joined_at,
        "updatedAt": int(time.time() * 1000),
    }
    await db["group_members"].update_one(
        {"groupId": group_id, "usernameLower": username.lower()},
        {"$set": doc},
        upsert=True,
    )
    # Invalidate roster caches for this group
    try:
        await local_cache.delete_prefix(f"roster:{group_id}:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return {"success": True}

@router.delete("/groups/{group_id}/members/{username}")
async def remove_group_member(group_id: str, username: str) -> Dict:
    db = get_db()
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    await db["group_members"].delete_one({"groupId": group_id, "usernameLower": uname.lower()})
    try:
        await local_cache.delete_prefix(f"roster:{group_id}:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return {"success": True}

@router.get("/metrics/presence")
async def presence_metrics():
    return prom_metrics_text()


@router.get("/groups")
async def list_groups(
    includeOnline: bool = False,
    includeMembers: bool = False,
    membersLimit: int = Query(
        _ROSTER_PREVIEW_LIMIT_DEFAULT,
        ge=1,
        le=_ROSTER_PREVIEW_LIMIT_MAX,
        description="Maximum number of member avatars to include per group",
    ),
    limit: int = Query(50, ge=1, le=200, description="Maximum groups to return"),
    offset: int = Query(0, ge=0, description="Number of groups to skip"),
    request: Request = None,
    response: Response = None,
) -> Dict:
    """List groups with pagination support for better frontend performance.
    
    Returns: { groups: [...], total: number, hasMore: boolean }
    """
    db = get_db()
    cache_key = f"groups:list:{'1' if includeOnline else '0'}:{limit}:{offset}"
    inm = request.headers.get("if-none-match") if request else None

    # Try local cache first (only for non-online/non-member queries to avoid staleness)
    if not includeOnline and not includeMembers:
        hit = await local_cache.get(cache_key)
        if hit is not None:
            if response is not None:
                try:
                    raw_for_tag = json.dumps(hit, separators=(",", ":"), sort_keys=True)
                    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
                    response.headers["ETag"] = _etag_for(raw_for_tag)
                    if inm and inm == _etag_for(raw_for_tag):
                        response.status_code = 304
                        return {}
                except Exception:
                    pass
            return hit

    # Get total count for pagination
    total = await db["groups"].count_documents({})
    
    # Fetch paginated groups
    docs = await db["groups"].find(
        {},
        {"id": 1, "name": 1, "description": 1, "avatarUrl": 1},
    ).sort("name", 1).skip(offset).limit(limit).to_list(length=limit)
    
    groups = [_clean_group(d) for d in docs]

    if groups:
        ids_for_preview = []
        for g in groups:
            lookup_id = g.get("id") or g.get("databaseId")
            if lookup_id:
                ids_for_preview.append(lookup_id)
        preview_map = await _fetch_latest_message_previews(db, ids_for_preview)
        fetched_at = int(time.time() * 1000)
        for g in groups:
            lookup_id = g.get("id") or g.get("databaseId")
            preview = preview_map.get(lookup_id) if lookup_id else None
            if preview:
                g["lastMessagePreview"] = preview
                created_at = preview.get("createdAt")
                if created_at is not None:
                    g["lastMessageAt"] = created_at
                    g["lastActiveAt"] = created_at
                g["summaryFetchedAt"] = fetched_at
            elif "lastMessagePreview" not in g:
                g["lastMessagePreview"] = None
    
    if includeOnline:
        counts = await _fetch_online_counts()
        for g in groups:
            g["onlineCount"] = counts.get(g["id"], 0)
    
    if includeMembers and groups:
        lookup_ids: List[str] = []
        for g in groups:
            val = g.get("id") or g.get("databaseId")
            if val:
                lookup_ids.append(val)
        member_map = await _fetch_member_preview(
            db,
            lookup_ids,
            membersLimit,
        )
        for group in groups:
            gid = group.get("id") or group.get("databaseId")
            if not gid:
                continue
            preview = member_map.get(gid)
            if preview:
                group["memberCount"] = preview.get("total", 0)
                group["memberPreview"] = preview.get("members", [])
            else:
                group["memberCount"] = 0
                group["memberPreview"] = []

    result = {
        "groups": groups,
        "total": total,
        "hasMore": offset + len(groups) < total
    }
    
    # Cache non-online results (only when not including members to avoid stale previews)
    if not includeOnline and not includeMembers:
        await local_cache.set(cache_key, result, ttl_seconds=60)  # Longer cache for paginated results
        if response is not None:
            try:
                raw_for_tag = json.dumps(result, separators=(",", ":"), sort_keys=True)
                response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
                response.headers["ETag"] = _etag_for(raw_for_tag)
            except Exception:
                pass
    
    return result

## Note: single /groups endpoint above handles includeOnline flag; duplicate removed

@router.get("/groups/{group_id}")
async def get_group(
    group_id: str,
    includeMembers: bool = False,
    membersLimit: int = Query(
        _ROSTER_PREVIEW_LIMIT_DEFAULT,
        ge=1,
        le=_ROSTER_PREVIEW_LIMIT_MAX,
        description="Maximum number of member avatars to include",
    ),
) -> Dict:
    db = get_db()
    g = await _find_group(db, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    cleaned = _clean_group(g)
    lookup_id = cleaned.get("id") or cleaned.get("databaseId")
    if lookup_id:
        preview_map = await _fetch_latest_message_previews(db, [lookup_id])
        preview = preview_map.get(lookup_id)
        fetched_at = int(time.time() * 1000)
        if preview:
            cleaned["lastMessagePreview"] = preview
            created_at = preview.get("createdAt")
            if created_at is not None:
                cleaned["lastMessageAt"] = created_at
                cleaned["lastActiveAt"] = created_at
            cleaned["summaryFetchedAt"] = fetched_at
        elif "lastMessagePreview" not in cleaned:
            cleaned["lastMessagePreview"] = None
    if includeMembers and (cleaned.get("id") or cleaned.get("databaseId")):
        lookup_id = cleaned.get("id") or cleaned.get("databaseId")
        member_map = await _fetch_member_preview(db, [lookup_id], membersLimit)
        preview = member_map.get(lookup_id)
        if preview:
            cleaned["memberCount"] = preview.get("total", 0)
            cleaned["memberPreview"] = preview.get("members", [])
        else:
            cleaned["memberCount"] = 0
            cleaned["memberPreview"] = []
    return cleaned

@router.post("/groups")
async def create_group(payload: Dict) -> Dict:
    db = get_db()
    raw_id = payload.get("id")
    group = {
        "id": raw_id or payload["name"].lower().replace(" ", "-"),
        "name": payload.get("name", "").strip(),
        "description": payload.get("description"),
        "avatarUrl": payload.get("avatarUrl"),
    }
    await db["groups"].update_one({"id": group["id"]}, {"$set": group}, upsert=True)
    saved = await _find_group(db, group["id"])
    # Invalidate groups list caches (local + cross-instance)
    try:
        await local_cache.delete_prefix("groups:list:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:list:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return _clean_group(saved)

@router.put("/groups/{group_id}")
async def update_group(group_id: str, payload: Dict) -> Dict:
    db = get_db()
    patch = {k: v for k, v in payload.items() if k in ["name", "description", "avatarUrl"]}
    target = await _find_group(db, group_id)
    if not target:
        raise HTTPException(status_code=404, detail="Group not found")
    lookup = {"id": target.get("id")} if target.get("id") else {"_id": target.get("_id")}
    await db["groups"].update_one(lookup, {"$set": patch})
    g = await _find_group(db, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    try:
        await local_cache.delete_prefix("groups:list:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:list:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return _clean_group(g)

@router.delete("/groups/{group_id}")
async def delete_group(group_id: str):
    db = get_db()
    target = await _find_group(db, group_id)
    if not target:
        raise HTTPException(status_code=404, detail="Group not found")
    lookup = {"id": target.get("id")} if target.get("id") else {"_id": target.get("_id")}
    gid = target.get("id") or str(target.get("_id"))
    await db["groups"].delete_one(lookup)
    if gid:
        await db[GROUP_MESSAGES_COLLECTION].delete_many({"$or": [{"groupId": gid}, {"roomId": gid}]})
        await db["reactions"].delete_many({"groupId": gid})
        await db["overlays"].delete_many({"groupId": gid})
    try:
        await local_cache.delete_prefix("groups:list:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:list:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return {"success": True}

