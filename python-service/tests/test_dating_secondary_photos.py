from __future__ import annotations

from typing import Optional

import pytest

from app.db import get_dating_db, get_user_db
from app.db.collections import DATING_PROFILES_COLLECTION
from app.repositories.user_profile import UserProfileRepository


async def _create_user_profile(user_id: str) -> None:
    user_repo = UserProfileRepository(get_user_db())
    await user_repo.create_profile(
        user_id=user_id,
        username=f"{user_id}-name",
        password_hash="hash",
        avatar_url=None,
        friends=None,
        created_at=111,
        updated_at=111,
    )


async def _upsert_profile(
    api_client,
    user_id: str,
    primary: str,
    photos: Optional[list[str]] = None,
) -> None:
    payload = {
        "userId": user_id,
        "firstName": "Taylor",
        "primaryPhotoUrl": primary,
    }
    if photos is not None:
        payload["photos"] = photos
    response = await api_client.put("/api/dating/profile", json=payload)
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_get_secondary_photos_returns_gallery(api_client) -> None:
    user_id = "user-gallery"
    primary = "https://cdn.test/primary.jpg"
    gallery = ["https://cdn.test/secondary-a.jpg", "https://cdn.test/secondary-b.jpg"]

    await _create_user_profile(user_id)
    await _upsert_profile(api_client, user_id, primary, gallery)

    resp = await api_client.get(f"/api/dating/profile/{user_id}/photos")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["userId"] == user_id
    assert payload["primaryPhotoUrl"] == primary
    assert payload["photos"] == gallery
    assert primary not in payload["photos"]


@pytest.mark.asyncio
async def test_post_secondary_photos_appends_without_touching_primary(api_client) -> None:
    user_id = "user-append"
    primary = "https://cdn.test/primary.jpg"
    initial_secondary = ["https://cdn.test/secondary-a.jpg"]
    new_secondary = "https://cdn.test/secondary-b.jpg"

    await _create_user_profile(user_id)
    await _upsert_profile(api_client, user_id, primary, initial_secondary)

    resp = await api_client.post(
        f"/api/dating/profile/{user_id}/photos",
        json={"url": new_secondary},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["primaryPhotoUrl"] == primary
    assert payload["photos"] == [*initial_secondary, new_secondary]

    dating_db = get_dating_db()
    stored = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": user_id})
    assert stored is not None
    assert stored.get("primaryPhotoUrl") == primary
    assert stored.get("photos") == [*initial_secondary, new_secondary]


@pytest.mark.asyncio
async def test_post_secondary_photos_replaces_array_and_filters_primary(api_client) -> None:
    user_id = "user-replace"
    primary = "https://cdn.test/primary.jpg"
    initial_secondary = ["https://cdn.test/secondary-a.jpg"]
    payload_secondary = [
        primary,
        "https://cdn.test/secondary-a.jpg",
        "https://cdn.test/secondary-b.jpg",
        "https://cdn.test/secondary-b.jpg",
    ]

    await _create_user_profile(user_id)
    await _upsert_profile(api_client, user_id, primary, initial_secondary)

    resp = await api_client.post(
        f"/api/dating/profile/{user_id}/photos",
        json={"photos": payload_secondary},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["primaryPhotoUrl"] == primary
    assert payload["photos"] == [
        "https://cdn.test/secondary-a.jpg",
        "https://cdn.test/secondary-b.jpg",
    ]
    assert primary not in payload["photos"]


@pytest.mark.asyncio
async def test_post_secondary_photos_enforces_limit(api_client) -> None:
    user_id = "user-limit"
    primary = "https://cdn.test/primary.jpg"
    await _create_user_profile(user_id)
    await _upsert_profile(api_client, user_id, primary, [])

    oversized = [f"https://cdn.test/sec-{index}.jpg" for index in range(12)]

    resp = await api_client.post(
        f"/api/dating/profile/{user_id}/photos",
        json={"photos": oversized},
    )
    assert resp.status_code == 400
