from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Dict
import base64
import os

from ..integrations.cloudinary import (
    is_enabled as cloud_enabled,
    ensure_configured,
    upload_data_url,
    get_status as get_cloud_status,
)

router = APIRouter()

# Allowed MIME types (mirror Node behavior)
ALLOWED_IMAGE_MIMES_PROFILE = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
}

ALLOWED_IMAGE_MIMES_CHAT = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    # SVG intentionally excluded for chat media for safety
}

ALLOWED_VIDEO_MIMES_CHAT = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/ogg",
}

# New: allow audio uploads for voice notes
ALLOWED_AUDIO_MIMES_CHAT = {
    "audio/webm",
    "audio/ogg",
    "audio/mpeg",  # mp3
    "audio/wav",
    "audio/mp4",
    "audio/aac",
}


@router.get("/cloudinary/status")
async def cloudinary_status() -> Dict:
    try:
        return get_cloud_status()
    except Exception:
        return {"configured": False}


@router.post("/uploads/avatar")
async def upload_avatar(avatar: UploadFile = File(...)) -> Dict:
    if not cloud_enabled():
        raise HTTPException(status_code=500, detail="Cloudinary not configured")
    ensure_configured()
    mime = avatar.content_type or ""
    if mime not in ALLOWED_IMAGE_MIMES_PROFILE:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported image type: {mime}. Allowed images: JPEG, PNG, WebP, GIF, AVIF, SVG."
            ),
        )
    data = await avatar.read()
    # Enforce max size (default 5MB)
    max_bytes = int(os.getenv("MAX_AVATAR_BYTES", str(5 * 1024 * 1024)))
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail="Avatar too large. Max 5 MB.")
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    url = upload_data_url(
        data_url,
        folder=os.getenv("CLOUDINARY_AVATAR_FOLDER", "funly/avatars"),
        resource_type="image",
        eager=[{"width": 256, "height": 256, "crop": "fill", "gravity": "auto", "format": "webp", "quality": "auto"}],
        eager_async=False,
    )
    return {"url": url, "type": mime}


@router.post("/uploads/chat-media")
async def upload_chat_media(media: UploadFile = File(...), username: str = "") -> Dict:
    if not cloud_enabled():
        raise HTTPException(status_code=500, detail="Cloudinary not configured")
    ensure_configured()
    mime_raw = media.content_type or ""
    # Some browsers send codecs in the MIME type (e.g., "audio/webm;codecs=opus").
    # Normalize by stripping parameters so we can match our allow-lists reliably.
    mime = mime_raw.split(";")[0].strip().lower()
    is_image = mime in ALLOWED_IMAGE_MIMES_CHAT
    is_video = mime in ALLOWED_VIDEO_MIMES_CHAT
    is_audio = mime in ALLOWED_AUDIO_MIMES_CHAT
    if mime == "image/svg+xml":
        raise HTTPException(status_code=415, detail="SVG images are not allowed for chat media.")
    if not (is_image or is_video or is_audio):
        # Fallback: infer from filename extension in case content-type is missing/unknown
        name = (media.filename or "").lower()
        if name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")):
            is_image, is_video, is_audio = True, False, False
            mime = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
                ".gif": "image/gif",
                ".avif": "image/avif",
            }[[ext for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"] if name.endswith(ext)][0]]
        elif name.endswith((".mp4", ".webm", ".mov", ".qt", ".ogg")):
            is_image, is_video, is_audio = False, True, False
            mime = {
                ".mp4": "video/mp4",
                ".webm": "video/webm",
                ".mov": "video/quicktime",
                ".qt": "video/quicktime",
                ".ogg": "video/ogg",
            }[[ext for ext in [".mp4", ".webm", ".mov", ".qt", ".ogg"] if name.endswith(ext)][0]]
        elif name.endswith((".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm")):
            is_image, is_video, is_audio = False, False, True
            mime = {
                ".mp3": "audio/mpeg",
                ".wav": "audio/wav",
                ".m4a": "audio/mp4",
                ".aac": "audio/aac",
                ".ogg": "audio/ogg",
                ".webm": "audio/webm",
            }[[ext for ext in [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm"] if name.endswith(ext)][0]]
        else:
            raise HTTPException(status_code=415, detail=f"Unsupported type: {mime_raw or 'unknown'}.")
    data = await media.read()
    # Enforce max size (default 10MB for images, 50MB for videos, 25MB for audio)
    max_image = int(os.getenv("MAX_CHAT_IMAGE_BYTES", str(10 * 1024 * 1024)))
    max_video = int(os.getenv("MAX_CHAT_VIDEO_BYTES", str(50 * 1024 * 1024)))
    max_audio = int(os.getenv("MAX_CHAT_AUDIO_BYTES", str(25 * 1024 * 1024)))
    lim = max_video if is_video else (max_audio if is_audio else max_image)
    if len(data) > lim:
        raise HTTPException(status_code=413, detail="Media too large.")
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    url = upload_data_url(
        data_url,
        folder=os.getenv("CLOUDINARY_CHAT_FOLDER", "funly/chat"),
        # Cloudinary handles audio as resource_type video
        resource_type="video" if (is_video or is_audio) else "image",
    )
    return {"url": url, "type": mime}


@router.post("/uploads/dating-photo")
async def upload_dating_photo(photo: UploadFile = File(...), username: str = "") -> Dict:
    if not cloud_enabled():
        raise HTTPException(status_code=500, detail="Cloudinary not configured")
    ensure_configured()
    mime = photo.content_type or ""
    if mime not in ALLOWED_IMAGE_MIMES_PROFILE:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported image type: {mime}. Allowed images: JPEG, PNG, WebP, GIF, AVIF, SVG."
            ),
        )
    data = await photo.read()
    # Enforce max size (default 5MB)
    max_bytes = int(os.getenv("MAX_DATING_BYTES", str(5 * 1024 * 1024)))
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail="Image too large. Max 5 MB.")
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    url = upload_data_url(
        data_url,
        folder=os.getenv("CLOUDINARY_DATING_FOLDER", "funly/dating"),
        resource_type="image",
        eager=[{"width": 256, "height": 256, "crop": "fill", "gravity": "auto", "format": "webp", "quality": "auto"}],
        eager_async=False,
    )
    return {"url": url, "type": mime}

