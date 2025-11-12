from fastapi import APIRouter, HTTPException
from typing import Dict, List
from ..db import get_db

router = APIRouter()

@router.get("/users/id/{user_id}/social-links")
async def get_social_links_by_id(user_id: str, legacy: str = ""):
    db = get_db()
    doc = await db["socialLinks"].find_one({"key": user_id})
    if not doc:
        legacy = (legacy or "").strip()
        if legacy:
            doc = await db["socialLinks"].find_one(
                {"$or": [
                    {"key": legacy},
                    {"key": legacy.lower()},
                ]}
            )
    return doc.get("links", []) if doc else []

@router.put("/users/id/{user_id}/social-links")
async def set_social_links_by_id(user_id: str, links: List[Dict]):
    db = get_db()
    await db["socialLinks"].update_one({"key": user_id}, {"$set": {"links": links}}, upsert=True)
    d = await db["socialLinks"].find_one({"key": user_id})
    return d.get("links", []) if d else []


@router.get("/users/{username}/social-links")
async def get_social_links_for_username(username: str):
    db = get_db()
    uname = (username or "").strip()
    if not uname:
        return []
    doc = await db["socialLinks"].find_one(
        {"$or": [
            {"key": uname},
            {"key": uname.lower()},
        ]}
    )
    return doc.get("links", []) if doc else []

@router.post("/users/migrate-social-links")
async def migrate_social_links(body: Dict):
    db = get_db()
    src = (body.get("from") or "").strip()
    dst = (body.get("to") or "").strip()
    if not src or not dst or src == dst:
        raise HTTPException(status_code=400, detail="invalid migration input")
    d = await db["socialLinks"].find_one({"key": src})
    links = d.get("links", []) if d else []
    await db["socialLinks"].update_one({"key": dst}, {"$set": {"links": links}}, upsert=True)
    return {"success": True}

@router.get("/users/id/{user_id}/bio")
async def get_bio(user_id: str):
    db = get_db()
    d = await db["bios"].find_one({"key": user_id})
    bio = d.get("bio", "") if d else ""
    return {"bio": bio}

@router.put("/users/id/{user_id}/bio")
async def set_bio(user_id: str, body: Dict):
    db = get_db()
    bio = body.get("bio", "")
    await db["bios"].update_one({"key": user_id}, {"$set": {"bio": bio}}, upsert=True)
    return {"bio": bio}
