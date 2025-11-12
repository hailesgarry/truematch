from pathlib import Path as _Path
# Load .env ASAP to ensure settings see env vars before any imports cache them
try:
    from dotenv import load_dotenv as _load_dotenv  # type: ignore
    _load_dotenv(dotenv_path=_Path(__file__).resolve().parent.parent / ".env", override=True)
except Exception:
    pass

import os
from fastapi import FastAPI
try:
    from fastapi.responses import ORJSONResponse  # type: ignore
    _DEFAULT_RESPONSE_CLS = ORJSONResponse
except Exception:
    from fastapi.responses import JSONResponse  # type: ignore
    _DEFAULT_RESPONSE_CLS = JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .db import connect_to_mongo, close_mongo_connection
from .routers import (
    groups,
    dating,
    uploads,
    users,
    messages,
    dm,
    indices,
    push,
    auth,
    filters,
)
import asyncio

from .routers.groups import warm_groups_cache
from fastapi.middleware.gzip import GZipMiddleware
from .redis_bus import start_consumer as redis_bus_start_consumer, stop as redis_bus_stop
from .readmodels import event_stream_handler

app = FastAPI(title="Truematch Python API", default_response_class=_DEFAULT_RESPONSE_CLS)
settings = get_settings()

# Build CORS origins list from env (supports CSV). Include both localhost and 127.0.0.1 by default.
_origins_env = os.getenv("CORS_ORIGINS") or os.getenv("CORS_ORIGIN") or "http://localhost:5173,http://127.0.0.1:5173"
_allow_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
try:
    # Log configured origins for debugging
    print(f"[CORS] allow_origins={_allow_origins}") 
except Exception:
    pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag"],
    allow_credentials=True,
)
app.add_middleware(GZipMiddleware, minimum_size=512)

# Simple slow-request logger
@app.middleware("http")
async def log_slow_requests(request, call_next):
    import time as _t
    t0 = _t.time()
    response = await call_next(request)
    dt = (_t.time() - t0) * 1000
    try:
        slow_ms = int(os.getenv("SLOW_REQUEST_MS", "800"))
        if dt >= slow_ms:
            print(f"[perf] slow request {request.method} {request.url.path} {int(dt)}ms status={response.status_code}")
    except Exception:
        pass
    return response

@app.on_event("startup")
async def startup():
    await connect_to_mongo()
    # Ensure essential indexes (idempotent)
    try:
        from .routers.indices import ensure_indexes  # reuse the same logic
        await ensure_indexes()  # called programmatically
    except Exception as e:
        try:
            print(f"[Mongo] ensure indexes failed (non-fatal): {e}") 
        except Exception:
            pass
    # Warm up frequently accessed caches (best-effort)
    try:
        await warm_groups_cache() 
    except Exception:
        pass
    # Start Redis pub/sub listener for read models and cache invalidations (optional)
    try:
        if get_settings().redis_pubsub_enabled:
            await redis_bus_start_consumer(event_stream_handler)
            print("[Events] Redis pub/sub listener started")
        else:
            print("[Events] Redis pub/sub disabled")
    except Exception as e:
        print(f"[Events] listener start failed (non-fatal): {e}")

    # Cloudinary status log (non-fatal)
    try:
        from .integrations.cloudinary import (
            is_enabled as cld_enabled,
            ensure_configured as cld_ensure,
            get_status as cld_status,
        )
        if cld_enabled():
            cld_ensure()
            info = cld_status() or {}
            ping_ok = None
            try:
                from cloudinary import api as cld_api  # type: ignore
                res = cld_api.ping()
                ping_ok = str(res.get("status", "")).lower() == "ok"
            except Exception:
                ping_ok = False
            print(
                f"[Cloudinary] configured={bool(info.get('configured'))} cloud={info.get('cloudName') or 'unknown'} via_url={'yes' if info.get('usingUrl') else 'no'} ping={'ok' if ping_ok else 'failed'}"
            )
        else:
            print("[Cloudinary] not configured")
    except Exception as e:
        print(f"[Cloudinary] status check error: {e}")

@app.on_event("shutdown")
async def shutdown():
    await close_mongo_connection()
    try:
        await redis_bus_stop()
    except Exception:
        pass

# Routers
app.include_router(groups.router, prefix="/api", tags=["groups"])
app.include_router(dating.router, prefix="/api", tags=["dating"])
app.include_router(uploads.router, prefix="/api", tags=["uploads"])
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(messages.router, prefix="/api", tags=["messages"])
app.include_router(dm.router, prefix="/api", tags=["dm"])
app.include_router(indices.router, prefix="/api", tags=["admin"])
app.include_router(push.router, prefix="/api", tags=["push"])
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(filters.router, prefix="/api", tags=["message-filters"])

@app.get("/")
async def root():
    return {"status": "python-api-ok"}   
 
@app.get("/api/health/db") 
async def db_health():
    from .db import _client as _mongo_client, _db as _mongo_db
    ok = bool(_mongo_client) and bool(_mongo_db)
    return {
        "mongo": "connected" if ok else "disconnected",
        "db": str(get_settings().mongo_db),
    }

# Redis health endpoint removed
