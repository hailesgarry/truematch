from __future__ import annotations

import pytest

from app.db import get_user_db
from app.repositories.user_profile import UserProfileRepository


@pytest.mark.asyncio
async def test_user_profile_repository_crud(api_client) -> None:
    repo = UserProfileRepository(get_user_db())

    created = await repo.create_profile(
        user_id="user-1",
        username="Alice",
        password_hash="hash",
        avatar_url=None,
        friends=None,
        created_at=123456,
        updated_at=123456,
    )

    assert created.username == "Alice"
    assert created.user_id == "user-1"

    fetched_by_id = await repo.get_by_user_id("user-1")
    assert fetched_by_id is not None
    assert fetched_by_id.username == "Alice"

    fetched_by_username = await repo.get_by_username("alice")
    assert fetched_by_username is not None

    updated = await repo.update_profile(
        user_id="user-1",
        updates={"avatarUrl": "https://example.com/avatar.png", "updatedAt": 654321},
    )
    assert updated.avatar_url == "https://example.com/avatar.png"

    exists = await repo.username_exists("Alice")
    assert exists is True

    available = await repo.username_exists("Bob")
    assert available is False
