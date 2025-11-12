import hashlib
from typing import Any

__all__ = ["weak_etag"]

def weak_etag(payload: Any) -> str:
    """Return a deterministic weak ETag for a JSON-serializable payload or string.
    Accepts dict/list/str/bytes; dict/list will be normalized to a compact JSON string with sorted keys.
    """
    import json
    if isinstance(payload, (dict, list)):
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    elif isinstance(payload, (bytes, bytearray)):
        raw = bytes(payload).decode("utf-8", errors="ignore")
    else:
        raw = str(payload)
    return 'W/"' + hashlib.md5(raw.encode("utf-8")).hexdigest() + '"'
