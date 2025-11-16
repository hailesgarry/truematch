from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
import sys

import pytest
import pytest_asyncio
from httpx import AsyncClient
from mongomock_motor import AsyncMongoMockClient

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.main import app
from app.db import close_mongo_connection, connect_to_mongo
from app.config import get_settings


@pytest.fixture(autouse=True)
def _env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MONGO_URI", "mongodb://localhost:27017/test")
    monkeypatch.setenv("MONGO_DB_NAME", "jesseiniya2023-test")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    get_settings.cache_clear()  # type: ignore[attr-defined]


@pytest_asyncio.fixture
async def mongo_client(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncMongoMockClient]:
    client = AsyncMongoMockClient()

    def _client_factory(*_args, **_kwargs) -> AsyncMongoMockClient:
        return client

    monkeypatch.setattr("app.db.AsyncIOMotorClient", _client_factory)
    yield client
    client.close()


@pytest_asyncio.fixture
async def api_client(mongo_client: AsyncMongoMockClient) -> AsyncIterator[AsyncClient]:
    await connect_to_mongo()
    async with AsyncClient(app=app, base_url="http://testserver") as client:
        yield client
    await close_mongo_connection()
