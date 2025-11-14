from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from bson import ObjectId
from fastapi import HTTPException

from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..collections import GROUP_MESSAGES_COLLECTION
from ..models.group import (
    GroupCreateRequest,
    GroupUpdateRequest,
)
from ..utils.http import weak_etag

_ROSTER_PREVIEW_LIMIT_DEFAULT = 5
_ROSTER_PREVIEW_LIMIT_MAX = 10
_ROSTER_PREVIEW_TTL = int(os.getenv("GROUP_ROSTER_PREVIEW_TTL", "30"))

ROSTER_PREVIEW_LIMIT_DEFAULT = _ROSTER_PREVIEW_LIMIT_DEFAULT
ROSTER_PREVIEW_LIMIT_MAX = _ROSTER_PREVIEW_LIMIT_MAX

_http_client: Optional[httpx.AsyncClient] = None
_presence_cache: Dict[str, Dict[str, int]] = {}
_presence_cache_expiry: Dict[str, float] = {}
_ONLINE_COUNTS_KEY = "online-counts"
_ONLINE_COUNTS_TTL = float(os.getenv("ONLINE_COUNTS_TTL", "5"))
_metrics = {
    "presence_timeouts": 0,
    "presence_requests": 0,
}


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
    unique_ids: List[str] = []
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
        cached = await local_cache.get(f"roster-preview:{gid}:{limit}")
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
                    "_id": {"groupId": "$groupId", "usernameLower": "$usernameLower"},
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
            payload = {"total": int(doc.get("total") or 0), "members": members}
            cached_results[gid] = payload
            await local_cache.set(
                f"roster-preview:{gid}:{limit}", payload, _ROSTER_PREVIEW_TTL
            )

        for gid in uncached_ids:
            if gid not in cached_results:
                empty = {"total": 0, "members": []}
                cached_results[gid] = empty
                await local_cache.set(
                    f"roster-preview:{gid}:{limit}", empty, _ROSTER_PREVIEW_TTL
                )

    return cached_results


def _clean_group(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    data = dict(doc)
    oid = data.pop("_id", None)
    if oid is not None:
        try:
            data["databaseId"] = str(oid)
        except Exception:
            pass
        else:
            if not data.get("id"):
                data["id"] = data["databaseId"]
    if data.get("id") and "slug" not in data:
        data["slug"] = data["id"]
    elif data.get("databaseId") and "slug" not in data:
        data["slug"] = data["databaseId"]
    if data.get("description") is None:
        data["description"] = ""
    if "onlineCount" not in data:
        data["onlineCount"] = 0
    return data


def _maybe_object_id(raw: str) -> Optional[ObjectId]:
    try:
        return ObjectId(str(raw))
    except Exception:
        return None


async def find_group(db, group_id: str) -> Optional[Dict[str, Any]]:
    if not group_id:
        return None
    doc = await db["groups"].find_one({"id": group_id})
    if doc:
        return doc
    oid = _maybe_object_id(group_id)
    if oid is not None:
        return await db["groups"].find_one({"_id": oid})
    return None


async def warm_groups_cache() -> None:
    try:
        from ..db import get_db

        db = get_db()
        docs = await db["groups"].find(
            {}, {"_id": 0, "id": 1, "name": 1, "description": 1, "avatarUrl": 1}
        ).to_list(length=1000)
        groups = [_clean_group(d) for d in docs]
        await local_cache.set("groups:list:0", groups, ttl_seconds=30)
    except Exception:
        pass


async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=3.0)
    return _http_client


def presence_metrics_text() -> str:
    return (
        f"# HELP presence_timeouts Total presence proxy timeouts\n"
        f"# TYPE presence_timeouts counter\n"
        f"presence_timeouts {_metrics['presence_timeouts']}\n"
        f"# HELP presence_requests Total presence proxy requests\n"
        f"# TYPE presence_requests counter\n"
        f"presence_requests {_metrics['presence_requests']}\n"
    )


async def fetch_online_counts() -> Dict[str, int]:
    now = time.time()
    cached = _presence_cache.get(_ONLINE_COUNTS_KEY)
    if cached and _presence_cache_expiry.get(_ONLINE_COUNTS_KEY, 0) > now:
        return cached
    node_url = os.getenv("API_URL", "http://localhost:8080/api").rstrip("/")
    url = f"{node_url}/groups/online-counts"
    _metrics["presence_requests"] += 1
    try:
        client = await _get_http_client()
        resp = await client.get(url, timeout=2.0)
        resp.raise_for_status()
        data = resp.json() or {}
        clean = {str(k): int(v) for k, v in data.items()}
        _presence_cache[_ONLINE_COUNTS_KEY] = clean
        _presence_cache_expiry[_ONLINE_COUNTS_KEY] = now + _ONLINE_COUNTS_TTL
        return clean
    except httpx.TimeoutException:
        _metrics["presence_timeouts"] += 1
        return {}
    except Exception:
        return {}


async def add_group_member(db, group_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
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
    try:
        await local_cache.delete_prefix(f"roster:{group_id}:")
        await local_cache.delete_prefix(f"roster-preview:{group_id}:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return {"success": True}


async def remove_group_member(db, group_id: str, username: str) -> Dict[str, Any]:
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(status_code=400, detail="username required")
    await db["group_members"].delete_one(
        {"groupId": group_id, "usernameLower": uname.lower()}
    )
    try:
        await local_cache.delete_prefix(f"roster:{group_id}:")
        await local_cache.delete_prefix(f"roster-preview:{group_id}:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass
    return {"success": True}


async def list_groups(
    db,
    *,
    include_online: bool = False,
    include_members: bool = False,
    members_limit: int = _ROSTER_PREVIEW_LIMIT_DEFAULT,
    limit: int = 50,
    offset: int = 0,
    cache_key: Optional[str] = None,
) -> Tuple[Dict[str, Any], Optional[str]]:
    if cache_key and not include_online and not include_members:
        hit = await local_cache.get(cache_key)
        if hit is not None:
            etag = _build_etag(hit)
            return hit, etag

    total = await db["groups"].count_documents({})
    docs = await (
        db["groups"]
        .find({"id": {"$exists": True}}, {"id": 1, "name": 1, "description": 1, "avatarUrl": 1})
        .sort("name", 1)
        .skip(offset)
        .limit(limit)
        .to_list(length=limit)
    )
    fallback_needed = offset + len(docs) < limit
    if fallback_needed:
        extra = await (
            db["groups"]
            .find({"id": {"$exists": False}}, {"name": 1, "description": 1, "avatarUrl": 1})
            .sort("name", 1)
            .skip(max(0, offset - len(docs)))
            .limit(limit - len(docs))
            .to_list(length=limit - len(docs))
        )
        docs.extend(extra)

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

    if include_online:
        counts = await fetch_online_counts()
        for g in groups:
            g["onlineCount"] = counts.get(g.get("id") or "", 0)

    if include_members and groups:
        lookup_ids: List[str] = []
        for g in groups:
            val = g.get("id") or g.get("databaseId")
            if val:
                lookup_ids.append(val)
        member_map = await _fetch_member_preview(db, lookup_ids, members_limit)
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
        "hasMore": offset + len(groups) < total,
    }

    if cache_key and not include_online and not include_members:
        await local_cache.set(cache_key, result, ttl_seconds=60)
        etag = _build_etag(result)
    else:
        etag = _build_etag(result)

    return result, etag


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
            dt = _parse_iso_datetime(raw)
            return int(dt.timestamp() * 1000) if dt else None
        if numeric < 1_000_000_000_000:
            numeric *= 1000
        return numeric
    return None


def _parse_iso_datetime(value: str) -> Optional[datetime]:
    try:
        # Replace trailing Z with UTC offset for fromisoformat compatibility
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except Exception:
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


def _build_etag(payload: Any) -> str:
    try:
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    except Exception:
        raw = str(payload)
    return weak_etag(raw)


def _slugify(value: str) -> str:
    cleaned = (value or "").strip().lower()
    return "-".join(part for part in cleaned.split() if part)


async def get_group(
    db,
    group_id: str,
    *,
    include_members: bool = False,
    members_limit: int = _ROSTER_PREVIEW_LIMIT_DEFAULT,
) -> Dict[str, Any]:
    doc = await find_group(db, group_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Group not found")

    group = _clean_group(doc)
    lookup_id = group.get("id") or group.get("databaseId")

    if lookup_id:
        preview_map = await _fetch_latest_message_previews(db, [lookup_id])
        preview = preview_map.get(lookup_id)
        fetched_at = int(time.time() * 1000)
        if preview:
            group["lastMessagePreview"] = preview
            created_at = preview.get("createdAt")
            if created_at is not None:
                group["lastMessageAt"] = created_at
                group["lastActiveAt"] = created_at
            group["summaryFetchedAt"] = fetched_at
        elif "lastMessagePreview" not in group:
            group["lastMessagePreview"] = None

    if include_members and lookup_id:
        member_map = await _fetch_member_preview(db, [lookup_id], members_limit)
        preview = member_map.get(lookup_id)
        if preview:
            group["memberCount"] = preview.get("total", 0)
            group["memberPreview"] = preview.get("members", [])
        else:
            group["memberCount"] = 0
            group["memberPreview"] = []

    return group


async def create_group(
    db,
    payload: GroupCreateRequest,
    *,
    explicit_id: Optional[str] = None,
) -> Dict[str, Any]:
    group_id = (explicit_id or payload.name or "").strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="Group id or name required")
    if not explicit_id:
        group_id = _slugify(group_id) or group_id

    doc: Dict[str, Any] = {
        "id": group_id,
        "name": (payload.name or "").strip(),
        "description": payload.description,
        "avatarUrl": payload.avatar_url,
    }

    await db["groups"].update_one({"id": group_id}, {"$set": doc}, upsert=True)
    saved = await find_group(db, group_id)
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to persist group")

    await _invalidate_group_caches()
    return _clean_group(saved)


async def update_group(
    db,
    group_id: str,
    payload: GroupUpdateRequest,
) -> Dict[str, Any]:
    target = await find_group(db, group_id)
    if not target:
        raise HTTPException(status_code=404, detail="Group not found")

    patch = payload.dict(by_alias=True, exclude_unset=True)
    allowed = {k: v for k, v in patch.items() if k in {"name", "description", "avatarUrl"}}
    if not allowed:
        return _clean_group(target)

    lookup = {"id": target.get("id")}
    if not target.get("id"):
        lookup = {"_id": target.get("_id")}

    await db["groups"].update_one(lookup, {"$set": allowed})
    refreshed = await find_group(db, group_id)
    if not refreshed:
        raise HTTPException(status_code=404, detail="Group not found")

    await _invalidate_group_caches()
    return _clean_group(refreshed)


async def delete_group(db, group_id: str) -> Dict[str, Any]:
    target = await find_group(db, group_id)
    if not target:
        raise HTTPException(status_code=404, detail="Group not found")

    lookup = {"id": target.get("id")}
    if not target.get("id"):
        lookup = {"_id": target.get("_id")}

    gid = target.get("id") or str(target.get("_id"))
    await db["groups"].delete_one(lookup)

    if gid:
        await db[GROUP_MESSAGES_COLLECTION].delete_many({"$or": [{"groupId": gid}, {"roomId": gid}]})
        await db["reactions"].delete_many({"groupId": gid})
        await db["overlays"].delete_many({"groupId": gid})

    await _invalidate_group_caches()
    return {"success": True}


async def _invalidate_group_caches() -> None:
    try:
        await local_cache.delete_prefix("groups:list:")
        await local_cache.delete_prefix("groups:summary:")
        await publish_invalidate("groups:list:")
        await publish_invalidate("groups:summary:")
    except Exception:
        pass


async def get_presence_metrics() -> str:
    return presence_metrics_text()


async def get_online_counts() -> Dict[str, int]:
    return await fetch_online_counts()
