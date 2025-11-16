"""MongoDB collection names used by the python-service."""

from __future__ import annotations

USER_PROFILES_COLLECTION = "user_profiles"
DATING_PROFILES_COLLECTION = "dating_profiles"
LEGACY_DATING_PROFILES_COLLECTIONS = ("profiles", "dating-profile")
LIKES_COLLECTION = "likes"

__all__ = [
    "USER_PROFILES_COLLECTION",
    "DATING_PROFILES_COLLECTION",
    "LEGACY_DATING_PROFILES_COLLECTIONS",
    "LIKES_COLLECTION",
]
