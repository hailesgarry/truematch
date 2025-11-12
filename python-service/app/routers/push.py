from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict
from ..db import get_db
from ..config import get_settings
from os import getenv
import json

try:
    from pywebpush import webpush, WebPushException  # type: ignore
except Exception:  # pragma: no cover
    webpush = None
    WebPushException = Exception

router = APIRouter()

class PushSubscription(BaseModel):
    endpoint: str
    keys: Dict[str, str]

@router.get("/push/public-key")
async def get_public_key():
    settings = get_settings()
    if not settings.vapid_public_key:
        return {"key": None}
    return {"key": settings.vapid_public_key}

@router.post("/push/subscribe")
async def subscribe_push(sub: PushSubscription):
    db = get_db()
    # Upsert by endpoint
    await db.push_subscriptions.update_one(
        {"endpoint": sub.endpoint},
        {"$set": {"endpoint": sub.endpoint, "keys": sub.keys}},
        upsert=True,
    )
    return {"ok": True}

@router.post("/push/unsubscribe")
async def unsubscribe_push(sub: PushSubscription):
    db = get_db()
    await db.push_subscriptions.delete_one({"endpoint": sub.endpoint})
    return {"ok": True}

class TestPushBody(BaseModel):
    title: str = "Funly"
    body: str = "Test notification"
    url: str | None = "/"

@router.post("/push/test")
async def send_test(body: TestPushBody):
    settings = get_settings()
    if webpush is None:
        raise HTTPException(500, detail="pywebpush not installed on server")
    if not (settings.vapid_public_key and settings.vapid_private_key):
        raise HTTPException(400, detail="VAPID keys not configured")
    db = get_db()
    subs = db.push_subscriptions.find({})
    sent = 0
    failed = 0
    async for sub in subs:
        try:
            payload = {
                "title": body.title,
                "body": body.body,
                "data": {"url": body.url or "/"},
            }
            webpush(
                subscription_info={
                    "endpoint": sub.get("endpoint"),
                    "keys": sub.get("keys", {}),
                },
                data=json.dumps(payload),
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
            )
            sent += 1
        except Exception as e:
            failed += 1
            # Optionally prune gone endpoints
            if isinstance(e, WebPushException):
                pass
    return {"sent": sent, "failed": failed}
