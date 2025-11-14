from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Query, Request, Response

from ..db import get_db
from ..models.group import GroupCreateRequest, GroupUpdateRequest
from ..services import group_service


router = APIRouter()

ROSTER_PREVIEW_LIMIT_DEFAULT = group_service.ROSTER_PREVIEW_LIMIT_DEFAULT
ROSTER_PREVIEW_LIMIT_MAX = group_service.ROSTER_PREVIEW_LIMIT_MAX


@router.post("/groups/{group_id}/members")
async def add_group_member(group_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    db = get_db()
    return await group_service.add_group_member(db, group_id, body)


@router.delete("/groups/{group_id}/members/{username}")
async def remove_group_member(group_id: str, username: str) -> Dict[str, Any]:
    db = get_db()
    return await group_service.remove_group_member(db, group_id, username)


@router.get("/metrics/presence")
async def presence_metrics() -> Response:
    metrics = await group_service.get_presence_metrics()
    return Response(content=metrics, media_type="text/plain; version=0.0.4")


@router.get("/groups")
async def list_groups(
    request: Request,
    response: Response,
    includeOnline: bool = False,
    includeMembers: bool = False,
    membersLimit: int = Query(
        ROSTER_PREVIEW_LIMIT_DEFAULT,
        ge=1,
        le=ROSTER_PREVIEW_LIMIT_MAX,
        description="Maximum number of member avatars to include per group",
    ),
    limit: int = Query(50, ge=1, le=200, description="Maximum groups to return"),
    offset: int = Query(0, ge=0, description="Number of groups to skip"),
) -> Dict[str, Any]:
    db = get_db()
    cacheable = not includeOnline and not includeMembers
    cache_key = None
    if cacheable:
        cache_key = f"groups:list:{limit}:{offset}"

    result, etag = await group_service.list_groups(
        db,
        include_online=includeOnline,
        include_members=includeMembers,
        members_limit=membersLimit,
        limit=limit,
        offset=offset,
        cache_key=cache_key,
    )

    inm = request.headers.get("if-none-match")

    if cacheable:
        response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    if etag:
        response.headers["ETag"] = etag
    if inm and etag and inm == etag:
        response.status_code = 304
        return {}

    return result


@router.get("/groups/{group_id}")
async def get_group(
    group_id: str,
    includeMembers: bool = False,
    membersLimit: int = Query(
        ROSTER_PREVIEW_LIMIT_DEFAULT,
        ge=1,
        le=ROSTER_PREVIEW_LIMIT_MAX,
        description="Maximum number of member avatars to include",
    ),
) -> Dict[str, Any]:
    db = get_db()
    return await group_service.get_group(
        db,
        group_id,
        include_members=includeMembers,
        members_limit=membersLimit,
    )


@router.post("/groups")
async def create_group(payload: Dict[str, Any]) -> Dict[str, Any]:
    db = get_db()
    request_model = GroupCreateRequest(**payload)
    explicit_id = payload.get("id")
    return await group_service.create_group(db, request_model, explicit_id=explicit_id)


@router.put("/groups/{group_id}")
async def update_group(group_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    db = get_db()
    request_model = GroupUpdateRequest(**payload)
    return await group_service.update_group(db, group_id, request_model)


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str) -> Dict[str, Any]:
    db = get_db()
    return await group_service.delete_group(db, group_id)


async def warm_groups_cache() -> None:
    await group_service.warm_groups_cache()
