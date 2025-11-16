"""Repository layer to abstract MongoDB access patterns."""

from .dating_profile import DatingProfileRepository
from .user_profile import UserProfileRepository

__all__ = ["DatingProfileRepository", "UserProfileRepository"]
