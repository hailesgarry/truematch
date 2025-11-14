"""Deprecated module maintained for backward compatibility.

Prefer importing the likes router from ``app.routers.likes``.
"""

from ..routers.likes import router

__all__ = ["router"]
