import os
from functools import lru_cache
from typing import Optional

import cloudinary
from cloudinary.uploader import upload as cld_upload


def _has_env() -> bool:
    if os.getenv("CLOUDINARY_URL"):
        return True
    return (
        bool(os.getenv("CLOUDINARY_CLOUD_NAME"))
        and bool(os.getenv("CLOUDINARY_API_KEY"))
        and bool(os.getenv("CLOUDINARY_API_SECRET"))
    )


@lru_cache()
def is_enabled() -> bool:
    return _has_env()


@lru_cache()
def ensure_configured():
    if not _has_env():
        return None
    # If CLOUDINARY_URL is set, Cloudinary SDK reads it automatically.
    # Force secure URLs globally.
    cloudinary.config(secure=True)
    # Else, if individual components are provided, set them explicitly.
    if not os.getenv("CLOUDINARY_URL"):
        cloudinary.config(
            cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
            api_key=os.getenv("CLOUDINARY_API_KEY"),
            api_secret=os.getenv("CLOUDINARY_API_SECRET"),
            secure=True,
        )
    return cloudinary


def upload_data_url(
    data_url: str,
    *,
    folder: Optional[str] = None,
    resource_type: str = "auto",
    public_id: Optional[str] = None,
    **extra,
) -> str:
    """Uploads a data URL to Cloudinary and returns the secure URL. If eager transformations are
    provided, returns the first eager secure URL when available."""
    if not is_enabled():
        raise RuntimeError("Cloudinary is not configured")
    ensure_configured()
    opts: dict = {"resource_type": resource_type, "unique_filename": True, "overwrite": False}
    if folder:
        opts["folder"] = folder
    if public_id:
        opts["public_id"] = public_id
    # Merge any caller-specified extra options (e.g., eager transformations)
    if extra:
        opts.update(extra)
    res = cld_upload(data_url, **opts)
    # Prefer an eager derived secure URL if present
    eager = res.get("eager")
    if eager and isinstance(eager, list) and eager:
        first = eager[0]
        if isinstance(first, dict):
            return first.get("secure_url") or first.get("url") or res.get("secure_url") or res.get("url")
    # Fallback to original secure URL
    return res.get("secure_url") or res.get("url")


def get_status() -> dict:
    """Returns a non-secret status for health checks."""
    configured = bool(is_enabled()) and ensure_configured() is not None
    using_url = bool(os.getenv("CLOUDINARY_URL"))
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    if using_url and not cloud_name:
        # Try to parse cloud name from CLOUDINARY_URL of form cloudinary://key:secret@cloud_name
        try:
            url = os.getenv("CLOUDINARY_URL", "")
            at = url.split("@", 1)[1] if "@" in url else ""
            cloud_name = at.split("/", 1)[0] if at else None
        except Exception:
            cloud_name = None
    return {
        "configured": bool(configured),
        "usingUrl": bool(using_url),
        "cloudName": cloud_name,
    }
