from __future__ import annotations

import pytest

from app.db import get_user_db
from app.repositories.user_profile import UserProfileRepository


@pytest.mark.asyncio
async def test_create_and_fetch_dating_profile(api_client) -> None:
    user_repo = UserProfileRepository(get_user_db())
    await user_repo.create_profile(
        user_id="user-42",
        username="Gloria",
        password_hash="hash",
        avatar_url=None,
        friends=None,
        created_at=111,
        updated_at=111,
    )

    response = await api_client.post(
        "/api/dating-profiles",
        json={
            "userId": "user-42",
            "firstName": "Gloria",
            "bio": "Hello world",
            "isActive": True,
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["userId"] == "user-42"
    assert payload["firstName"] == "Gloria"
    assert "username" not in payload
    assert "displayName" not in payload

    get_resp = await api_client.get("/api/dating-profiles/user-42")
    assert get_resp.status_code == 200
    fetched = get_resp.json()
    assert fetched["userId"] == "user-42"
    assert fetched["firstName"] == "Gloria"
    assert "username" not in fetched

    patch_resp = await api_client.patch(
        "/api/dating-profiles/user-42",
        json={"bio": "Updated", "isActive": False},
    )
    assert patch_resp.status_code == 200
    patched = patch_resp.json()
    assert patched["bio"] == "Updated"
    assert patched["isActive"] is False

    stored_user = await user_repo.collection.find_one({"userId": "user-42"})
    assert stored_user is not None
    assert stored_user.get("hasDatingProfile") is True


@pytest.mark.asyncio
async def test_create_dating_profile_missing_user(api_client) -> None:
    response = await api_client.post(
        "/api/dating-profiles",
        json={"userId": "missing", "firstName": "Nobody"},
    )
    assert response.status_code == 404
