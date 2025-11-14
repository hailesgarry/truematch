"""Deprecated routes package.

Routers now live under ``app.routers``. This module re-exports the likes
router for any legacy imports while new code should target
``app.routers.likes`` instead.
"""

from ..routers.likes import router as likes_router

__all__ = ["likes_router"]
