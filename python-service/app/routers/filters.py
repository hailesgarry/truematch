from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import time

from ..db import get_db

router = APIRouter()


REMOVAL_RETENTION_DAYS = 45
REMOVAL_RETENTION_MS = REMOVAL_RETENTION_DAYS * 24 * 60 * 60 * 1000
REMOVAL_FETCH_LIMIT = 200


class FilterMutation(BaseModel):
    groupId: str = Field(..., min_length=1, pattern=r"\S")
    username: str = Field(..., min_length=1, pattern=r"\S")


def _normalize_username(value: str) -> str:
    return value.strip().lower()


def _normalize_group(value: str) -> str:
    return value.strip()


async def _fetch_filters(db, user_id: str) -> List[Dict[str, Any]]:
    cursor = (
        db["message_filters"]
        .find({"userId": user_id}, {"_id": 0})
        .sort("createdAt", 1)
    )
    docs: List[Dict[str, Any]] = []
    async for doc in cursor:
        docs.append(doc)
    return docs

async def _fetch_removals(db, user_id: str) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {"userId": user_id}
    now_ms = int(time.time() * 1000)
    cutoff = now_ms - REMOVAL_RETENTION_MS
    query["removedAt"] = {"$gte": cutoff}
    cursor = (
        db["message_filter_removals"]
        .find(query, {"_id": 0})
        .sort("removedAt", -1)
        .limit(REMOVAL_FETCH_LIMIT)
    )
    docs: List[Dict[str, Any]] = []
    async for doc in cursor:
        docs.append(doc)
    return docs


def _serialize(
    user_id: str,
    docs: List[Dict[str, Any]],
    removal_docs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    groups: Dict[str, List[str]] = {}
    for doc in docs:
        group_id = (doc.get("groupId") or "").strip()
        username = (doc.get("username") or "").strip()
        username_lower = (doc.get("usernameLower") or "").strip().lower()
        if not group_id or not username:
            continue
        created_at = doc.get("createdAt")
        updated_at = doc.get("updatedAt")
        entry: Dict[str, Any] = {
            "groupId": group_id,
            "username": username,
            "normalized": username_lower or _normalize_username(username),
        }
        if isinstance(created_at, (int, float)):
            entry["createdAt"] = int(created_at)
        elif created_at:
            try:
                entry["createdAt"] = int(created_at)
            except Exception:
                pass
        if isinstance(updated_at, (int, float)):
            entry["updatedAt"] = int(updated_at)
        elif updated_at:
            try:
                entry["updatedAt"] = int(updated_at)
            except Exception:
                pass
        items.append(entry)
        groups.setdefault(group_id, []).append(username)
    removal_items: List[Dict[str, Any]] = []
    for doc in removal_docs or []:
        group_id = (doc.get("groupId") or "").strip()
        username = (doc.get("username") or "").strip()
        normalized = (doc.get("usernameLower") or "").strip().lower()
        if not group_id or not username:
            continue
        filtered_at = doc.get("filteredAt") or doc.get("createdAt")
        removed_at = doc.get("removedAt") or doc.get("updatedAt")
        entry: Dict[str, Any] = {
            "groupId": group_id,
            "username": username,
            "normalized": normalized or _normalize_username(username),
        }
        if isinstance(filtered_at, (int, float)):
            entry["filteredAt"] = int(filtered_at)
        elif filtered_at:
            try:
                entry["filteredAt"] = int(filtered_at)
            except Exception:
                pass
        if isinstance(removed_at, (int, float)):
            entry["removedAt"] = int(removed_at)
        elif removed_at:
            try:
                entry["removedAt"] = int(removed_at)
            except Exception:
                pass
        removal_items.append(entry)

    return {
        "userId": user_id,
        "items": items,
        "groups": groups,
        "removals": removal_items,
    }


@router.get("/users/{user_id}/message-filters")
async def list_filters(user_id: str):
    user = (user_id or "").strip()
    if not user:
        raise HTTPException(status_code=400, detail="user_id required")
    db = get_db()
    docs = await _fetch_filters(db, user)
    removal_docs = await _fetch_removals(db, user)
    return _serialize(user, docs, removal_docs)


@router.post("/users/{user_id}/message-filters")
async def add_filter(user_id: str, payload: FilterMutation):
    user = (user_id or "").strip()
    if not user:
        raise HTTPException(status_code=400, detail="user_id required")
    group_id = _normalize_group(payload.groupId)
    username = payload.username.strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="groupId required")
    if not username:
        raise HTTPException(status_code=400, detail="username required")
    username_lower = _normalize_username(username)
    if not username_lower:
        raise HTTPException(status_code=400, detail="username invalid")

    db = get_db()
    now_ms = int(time.time() * 1000)
    await db["message_filters"].update_one(
        {
            "userId": user,
            "groupId": group_id,
            "usernameLower": username_lower,
        },
        {
            "$setOnInsert": {
                "userId": user,
                "groupId": group_id,
                "usernameLower": username_lower,
                "createdAt": now_ms,
            },
            "$set": {
                "username": username,
                "updatedAt": now_ms,
            },
        },
        upsert=True,
    )

    docs = await _fetch_filters(db, user)
    removal_docs = await _fetch_removals(db, user)
    return _serialize(user, docs, removal_docs)


@router.delete("/users/{user_id}/message-filters")
async def remove_filter(user_id: str, payload: FilterMutation = Body(...)):
    user = (user_id or "").strip()
    if not user:
        raise HTTPException(status_code=400, detail="user_id required")
    group_id = _normalize_group(payload.groupId)
    username = payload.username.strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="groupId required")
    if not username:
        raise HTTPException(status_code=400, detail="username required")
    username_lower = _normalize_username(username)
    if not username_lower:
        raise HTTPException(status_code=400, detail="username invalid")

    db = get_db()
    now_ms = int(time.time() * 1000)
    removed_doc = await db["message_filters"].find_one_and_delete(
        {
            "userId": user,
            "groupId": group_id,
            "usernameLower": username_lower,
        },
        projection={
            "_id": 0,
            "createdAt": 1,
            "updatedAt": 1,
            "username": 1,
            "usernameLower": 1,
        },
    )

    if removed_doc:
        filtered_at = removed_doc.get("createdAt")
        if not isinstance(filtered_at, (int, float)):
            filtered_at = now_ms
        removal_entry = {
            "userId": user,
            "groupId": group_id,
            "username": removed_doc.get("username") or username,
            "usernameLower": removed_doc.get("usernameLower")
            or username_lower,
            "filteredAt": int(filtered_at),
            "removedAt": now_ms,
            "updatedAt": now_ms,
        }
        await db["message_filter_removals"].insert_one(removal_entry)
        # Trim old removal entries beyond retention
        cutoff = now_ms - REMOVAL_RETENTION_MS
        await db["message_filter_removals"].delete_many(
            {"userId": user, "removedAt": {"$lt": cutoff}}
        )

    docs = await _fetch_filters(db, user)
    removal_docs = await _fetch_removals(db, user)
    return _serialize(user, docs, removal_docs)
