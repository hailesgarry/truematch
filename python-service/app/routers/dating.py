from fastapi import APIRouter, HTTPException, Query, Request, Response
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from ..db import get_dating_db, get_db, get_user_db
from ..db.collections import DATING_PROFILES_COLLECTION, LIKES_COLLECTION, USER_PROFILES_COLLECTION
from ..cache import cache as local_cache
from ..cache_bus import publish_invalidate
from ..utils.http import weak_etag
import json
import math
import re
import time
from urllib.parse import urlparse
from bson import ObjectId  # type: ignore
from ..config import get_settings
from ..services.user_profile_service import get_current_profile

def _etag_for(payload: str) -> str:
    return weak_etag(payload)


RELATIONSHIP_OPTIONS = (
    "New friends",
    "Something casual",
    "Long-term partner",
    "Life partner",
    "Still figuring it out",
)

SECONDARY_PHOTO_LIMIT = 8

_EARTH_RADIUS_M = 6_371_000.0


def _haversine_distance_m(
    lat1: Optional[float],
    lon1: Optional[float],
    lat2: Optional[float],
    lon2: Optional[float],
) -> Optional[float]:
    """Return the great-circle distance in meters between two coordinates."""
    try:
        if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
            return None
        phi1 = math.radians(float(lat1))
        phi2 = math.radians(float(lat2))
        dphi = math.radians(float(lat2) - float(lat1))
        dlambda = math.radians(float(lon2) - float(lon1))
    except (TypeError, ValueError):
        return None

    sin_dphi = math.sin(dphi / 2.0)
    sin_dlambda = math.sin(dlambda / 2.0)
    a = sin_dphi * sin_dphi + math.cos(phi1) * math.cos(phi2) * sin_dlambda * sin_dlambda
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
    return float(_EARTH_RADIUS_M * c)


def _build_geojson_point(lat: float, lon: float) -> Dict[str, Any]:
    return {"type": "Point", "coordinates": [float(lon), float(lat)]}


def _parse_geojson_point(raw: Any) -> Optional[Dict[str, float]]:
    if not isinstance(raw, dict):
        return None
    gtype = str(raw.get("type") or "").strip().lower()
    if gtype != "point":
        return None
    coords = raw.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        return None
    lon = _coerce_float(coords[0], min_val=-180.0, max_val=180.0)
    lat = _coerce_float(coords[1], min_val=-90.0, max_val=90.0)
    if lat is None or lon is None:
        return None
    return {"lat": lat, "lon": lon}


def _clean_text(value: Any, max_len: int = 120) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned


def _canonical_gender(value: Any) -> Optional[str]:
    text = _clean_text(value, 16)
    if not text:
        return None
    lookup = {"female": "Female", "male": "Male"}
    return lookup.get(text.lower())


def _canonical_interest(value: Any) -> Optional[str]:
    text = _clean_text(value, 24)
    if not text:
        return None
    lookup = {
        "female": "Female",
        "woman": "Female",
        "women": "Female",
        "male": "Male",
        "man": "Male",
        "men": "Male",
        "everyone": "Everyone",
        "everybody": "Everyone",
        "all": "Everyone",
        "any": "Everyone",
    }
    return lookup.get(text.lower())


def _clean_url(value: Any, max_len: int = 512) -> Optional[str]:
    if not isinstance(value, str):
        return None
    url_text = value.strip()
    if not url_text:
        return None
    if len(url_text) > max_len:
        url_text = url_text[:max_len]
    try:
        parsed = urlparse(url_text)
    except Exception:
        return None
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc:
        return None
    return url_text


def _coerce_float(
    value: Any,
    *,
    min_val: Optional[float] = None,
    max_val: Optional[float] = None,
) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or math.isinf(num):
        return None
    if min_val is not None and num < min_val:
        return None
    if max_val is not None and num > max_val:
        return None
    return num


def _coerce_int(
    value: Any,
    *,
    min_val: Optional[int] = None,
    max_val: Optional[int] = None,
) -> Optional[int]:
    try:
        num = int(value)
    except (TypeError, ValueError):
        return None
    if min_val is not None and num < min_val:
        return None
    if max_val is not None and num > max_val:
        return None
    return num


_MATCH_STOPWORDS: Set[str] = {
    "about",
    "along",
    "also",
    "always",
    "and",
    "because",
    "being",
    "can't",
    "can't",
    "cant",
    "don't",
    "dont",
    "everyone",
    "from",
    "have",
    "into",
    "it's",
    "its",
    "like",
    "love",
    "maybe",
    "more",
    "others",
    "people",
    "really",
    "that",
    "their",
    "they",
    "this",
    "through",
    "very",
    "we're",
    "were",
    "what",
    "when",
    "where",
    "with",
    "your",
    "you're",
    "yours",
}

_TOKEN_PATTERN = re.compile(r"[a-z0-9']+") 


def _tokenize_keywords(*values: Any) -> Set[str]:
    tokens: Set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        for token in _TOKEN_PATTERN.findall(raw.lower()):
            cleaned = token.strip("'")
            if len(cleaned) < 3:
                continue
            if cleaned in _MATCH_STOPWORDS:
                continue
            tokens.add(cleaned)
    return tokens


def _synchronize_name_fields(doc: Dict[str, Any]) -> None:
    """Ensure only the canonical firstName field remains on the document."""

    if not isinstance(doc, dict):
        return

    canonical: Optional[str] = None
    for key in ("firstName", "displayName", "name", "username"):
        value = doc.get(key)
        if isinstance(value, str) and value.strip():
            canonical = value.strip()
            break

    if canonical:
        doc["firstName"] = canonical
    elif "firstName" in doc:
        doc.pop("firstName", None)

    for legacy_key in ("displayName", "name", "username", "usernameLower"):
        if legacy_key in doc:
            doc.pop(legacy_key, None)


PROFILE_TEXT_FIELD_LIMITS: Dict[str, int] = {
    # Preferences and partner description prompts
    "partnerLookingFor": 600,
    "lookingForInPartner": 600,
    "partnerDescription": 600,
    # Interests & hobbies prompts
    "favoriteMovie": 200,
    "favoriteMusic": 200,
    "musicPreference": 200,
    "musicPreferences": 200,
    "favoriteFood": 200,
    "foodPreference": 200,
    "foodPreferences": 200,
    "perfectMatchDescription": 600,
    "perfectMatch": 600,
    "idealPartner": 600,
    "hobby": 200,
    "hobbies": 200,
    "favoriteHobby": 200,
    "weekendActivity": 200,
    "weekendActivities": 200,
    "typicalWeekend": 200,
    "travelDestination": 200,
    "dreamDestination": 200,
    "favoriteDestination": 200,
    "fitnessActivity": 200,
    "workout": 200,
    "exercise": 200,
    # Background prompts
    "height": 40,
    "bodyType": 80,
    "education": 160,
    "educationLevel": 160,
    "school": 160,
    "jobTitle": 160,
    "occupation": 160,
    "job": 160,
    "company": 160,
    "workplace": 160,
    "employer": 160,
    "lifePhilosophy": 400,
    "philosophy": 400,
    "outlook": 400,
    "communicationStyle": 200,
    "communicationPreference": 200,
    "howToCommunicate": 200,
    # Answer questions prompts
    "datingProCon": 400,
    "prosAndCons": 400,
    "prosConsOfDatingMe": 400,
    "loveLanguage": 200,
    "myLoveLanguage": 200,
    "loveLanguages": 200,
    "firstDate": 400,
    "idealFirstDate": 400,
    "perfectFirstDate": 400,
    "greenFlag": 200,
    "greenFlags": 200,
    "myGreenFlag": 200,
    "redFlag": 200,
    "redFlags": 200,
    "dealBreaker": 200,
    "seekingFor": 400,
    "seeking": 400,
    "lookingForRelationship": 400,
    "selfCare": 400,
    "selfCareIs": 400,
    "mySelfCare": 400,
    "simplePleasures": 400,
    "mySimplePleasures": 400,
    "simplePleasure": 400,
    "greatRelationship": 400,
    "relationshipGreat": 400,
    "whatMakesRelationshipGreat": 400,
}

PROFILE_PROMPT_FIELDS: Tuple[str, ...] = tuple(PROFILE_TEXT_FIELD_LIMITS.keys())

LEGACY_PROFILE_FIELDS: Tuple[str, ...] = (
    "about",
    "aboutMe",
    "bio",
    "summary",
    "description",
    "partnerPreferences",
    "relationship",
    "relationships",
    "relationshipGoal",
)

PROFILE_KEYWORD_FIELDS: Tuple[str, ...] = (
    "mood",
    "partnerLookingFor",
    "lookingForInPartner",
    "partnerDescription",
    "favoriteMovie",
    "favoriteMusic",
    "musicPreference",
    "musicPreferences",
    "favoriteFood",
    "foodPreference",
    "foodPreferences",
    "perfectMatch",
    "perfectMatchDescription",
    "idealPartner",
    "hobby",
    "hobbies",
    "favoriteHobby",
    "weekendActivity",
    "weekendActivities",
    "typicalWeekend",
    "travelDestination",
    "dreamDestination",
    "favoriteDestination",
    "fitnessActivity",
    "workout",
    "exercise",
    "lifePhilosophy",
    "philosophy",
    "outlook",
    "communicationStyle",
    "communicationPreference",
    "howToCommunicate",
    "datingProCon",
    "prosAndCons",
    "prosConsOfDatingMe",
    "loveLanguage",
    "myLoveLanguage",
    "loveLanguages",
    "firstDate",
    "idealFirstDate",
    "perfectFirstDate",
    "greenFlag",
    "greenFlags",
    "myGreenFlag",
    "redFlag",
    "redFlags",
    "dealBreaker",
    "seekingFor",
    "seeking",
    "lookingForRelationship",
    "selfCare",
    "selfCareIs",
    "mySelfCare",
    "simplePleasures",
    "mySimplePleasures",
    "simplePleasure",
    "greatRelationship",
    "relationshipGreat",
    "whatMakesRelationshipGreat",
)

PROFILE_VISIBILITY_BASE_FIELDS: Tuple[str, ...] = (
    "mood",
    "gender",
    "interestedIn",
    "smoking",
    "drinking",
    "children",
    "relocation",
    "nationality",
    "religion",
    "bodyType",
)

PROFILE_VISIBILITY_FIELDS: Tuple[str, ...] = PROFILE_VISIBILITY_BASE_FIELDS + PROFILE_PROMPT_FIELDS

ALLOWED_UPSERT_FIELDS: Set[str] = {
    "photos",
    "photoPlacements",
    "photoUrl",
    "primaryPhotoUrl",
    "photo",
    "mood",
    "age",
    "gender",
    "firstName",
    "interestedIn",
    "location",
    "preferences",
    "relationshipLookingFor",
    "relationshipPreference",
    "relationshipsLookingFor",
    "smoking",
    "drinking",
    "children",
    "childrenCount",
    "relocation",
    "religion",
    "nationality",
    "bodyType",
}

ALLOWED_UPSERT_FIELDS.update(PROFILE_PROMPT_FIELDS)

PROFILE_CLEAR_BASE_FIELDS: Tuple[str, ...] = (
    "photos",
    "photoPlacements",
    "photoUrl",
    "primaryPhotoUrl",
    "photo",
    "mood",
    "gender",
    "interestedIn",
    "smoking",
    "drinking",
    "children",
    "childrenCount",
    "relocation",
    "religion",
    "nationality",
    "bodyType",
    "preferences",
    "location",
    "relationshipLookingFor",
    "relationshipPreference",
    "relationshipsLookingFor",
    "age",
    "datingProfileCreatedAt",
)

PROFILE_CLEAR_FIELDS: Tuple[str, ...] = (
    PROFILE_CLEAR_BASE_FIELDS
    + PROFILE_PROMPT_FIELDS
    + LEGACY_PROFILE_FIELDS
)

def _canonical_relationship_list(raw: Any) -> List[str]:
    items: List[str] = []
    if raw is None:
        return items
    if isinstance(raw, (list, tuple, set)):
        source = list(raw)
    else:
        source = [raw]

    def _normalize_entry(entry: Any) -> Optional[str]:
        text = _clean_text(entry, 80)
        if not text:
            return None
        lower = text.lower()
        for option in RELATIONSHIP_OPTIONS:
            if option.lower() == lower:
                return option

        if "friend" in lower:
            return "New friends"
        if "casual" in lower or "romance" in lower or "dating" in lower:
            return "Something casual"
        if "long term" in lower or "long-term" in lower or "longterm" in lower:
            return "Long-term partner"
        if "life partner" in lower or "life-partner" in lower or "serious" in lower:
            return "Life partner"
        if "figure" in lower or "not sure" in lower or "unsure" in lower or "undecided" in lower:
            return "Still figuring it out"

        legacy_map = {
            "friendship": "New friends",
            "romance/dating": "Something casual",
            "long term relationship": "Long-term partner",
            "serious relationship": "Life partner",
        }
        mapped = legacy_map.get(lower)
        if mapped:
            return mapped
        return text

    seen = set()
    for entry in source:
        normalized = _normalize_entry(entry)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(normalized)

    # Preserve canonical ordering preference
    if not items:
        return items
    items_lower = [value.lower() for value in items]
    ordered: List[str] = []
    added = set()
    for option in RELATIONSHIP_OPTIONS:
        key = option.lower()
        if key in items_lower and key not in added:
            ordered.append(option)
            added.add(key)
    for entry, key in zip(items, items_lower):
        if key not in added:
            ordered.append(entry)
            added.add(key)
    return ordered


def _has_visible_dating_profile(doc: Dict[str, Any]) -> bool:
    if not isinstance(doc, dict):
        return False
    if bool(doc.get("hasDatingProfile")):
        return True

    primary_photo = doc.get("primaryPhotoUrl")
    if isinstance(primary_photo, str) and primary_photo.strip():
        return True

    photos = doc.get("photos")
    if isinstance(photos, (list, tuple)):
        for entry in photos:
            if isinstance(entry, str) and entry.strip():
                return True

    for key in ("photoUrl", "photo"):
        value = doc.get(key)
        if isinstance(value, str) and value.strip():
            return True

    age_val = doc.get("age")
    if isinstance(age_val, (int, float)):
        return True

    for key in PROFILE_VISIBILITY_FIELDS:
        limit = PROFILE_TEXT_FIELD_LIMITS.get(key, 600)
        if _clean_text(doc.get(key), limit):
            return True

    prefs = doc.get("preferences")
    if isinstance(prefs, dict) and prefs:
        return True

    location = doc.get("location")
    if isinstance(location, dict):
        for loc_key in ("city", "state", "country", "formatted"):
            if _clean_text(location.get(loc_key), 160):
                return True

    return False


def _normalize_preferences(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    prefs: Dict[str, Any] = {}
    age_raw = raw.get("age") or raw.get("ageRange")
    age_norm: Optional[Dict[str, int]] = None
    if isinstance(age_raw, dict):
        min_age = _coerce_int(age_raw.get("min"), min_val=18, max_val=120)
        max_age = _coerce_int(age_raw.get("max"), min_val=18, max_val=120)
        if min_age is not None and max_age is not None:
            lo, hi = sorted((min_age, max_age))
            age_norm = {"min": lo, "max": hi}
    elif isinstance(age_raw, (list, tuple)) and len(age_raw) == 2:
        min_age = _coerce_int(age_raw[0], min_val=18, max_val=120)
        max_age = _coerce_int(age_raw[1], min_val=18, max_val=120)
        if min_age is not None and max_age is not None:
            lo, hi = sorted((min_age, max_age))
            age_norm = {"min": lo, "max": hi}
    if age_norm:
        prefs["age"] = age_norm
    return prefs or None


def _normalize_photos(
    raw: Any,
    limit: int = 8,
    *,
    allow_empty: bool = False,
) -> Optional[List[str]]:
    if raw is None:
        return None
    if isinstance(raw, (list, tuple, set)):
        candidates = list(raw)
        provided_sequence = True
    else:
        candidates = [raw]
        provided_sequence = False
    photos: List[str] = []
    seen = set()
    for entry in candidates:
        url = _clean_url(entry)
        if not url:
            continue
        if url in seen:
            continue
        seen.add(url)
        photos.append(url)
        if len(photos) >= limit:
            break
    if photos:
        return photos
    if allow_empty and provided_sequence:
        return []
    return None


def _normalize_photo_placements(
    raw: Any,
    allowed_photos: Iterable[str],
    *,
    max_entries: int = 16,
) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}

    allowed_set = {
        url.strip()
        for url in allowed_photos
        if isinstance(url, str) and url.strip()
    }

    placements: Dict[str, str] = {}
    for key, value in raw.items():
        if len(placements) >= max_entries:
            break
        url = _clean_url(key)
        if not url:
            continue
        if allowed_set and url not in allowed_set:
            continue
        section = _clean_text(value, 64)
        if not section:
            continue
        placements[url] = section
    return placements


def _collect_secondary_photos(
    doc: Dict[str, Any],
    *,
    primary: Optional[str] = None,
    limit: int = SECONDARY_PHOTO_LIMIT,
) -> List[str]:
    if not isinstance(doc, dict):
        return []
    primary_url = primary
    if not primary_url:
        candidate = _extract_primary_photo(doc)
        primary_url = candidate if candidate else None

    raw_photos = doc.get("photos")
    if not isinstance(raw_photos, (list, tuple)):
        return []

    seen: Set[str] = set()
    secondary: List[str] = []
    for entry in raw_photos:
        url = _clean_url(entry)
        if not url:
            continue
        if primary_url and url == primary_url:
            continue
        if url in seen:
            continue
        seen.add(url)
        secondary.append(url)
        if len(secondary) >= limit:
            break
    return secondary


def _sanitize_secondary_photos_input(
    raw: Any,
    *,
    primary: Optional[str],
    limit: int = SECONDARY_PHOTO_LIMIT,
) -> List[str]:
    normalized = _normalize_photos(raw, limit=limit + 1, allow_empty=True)
    if normalized is None:
        return []
    if len(normalized) > limit:
        raise ValueError("secondary photo limit exceeded")
    seen: Set[str] = set()
    cleaned: List[str] = []
    for url in normalized:
        if primary and url == primary:
            continue
        if url in seen:
            continue
        seen.add(url)
        cleaned.append(url)
        if len(cleaned) >= limit:
            break
    return cleaned


def _extract_primary_photo(doc: Dict[str, Any]) -> Optional[str]:
    if not isinstance(doc, dict):
        return None
    for key in ("primaryPhotoUrl", "photoUrl", "photo"):
        candidate = doc.get(key)
        if isinstance(candidate, str):
            trimmed = candidate.strip()
            if trimmed:
                return trimmed
    photos = doc.get("photos")
    if isinstance(photos, (list, tuple)):
        for entry in photos:
            if not isinstance(entry, str):
                continue
            trimmed = entry.strip()
            if trimmed:
                return trimmed
    return None


def _apply_primary_photo_metadata(doc: Dict[str, Any]) -> None:
    if not isinstance(doc, dict):
        return
    primary = _extract_primary_photo(doc)
    if primary:
        doc["primaryPhotoUrl"] = primary
    else:
        doc["primaryPhotoUrl"] = None
    doc.pop("photoUrl", None)
    doc.pop("photo", None)


def _normalize_location(raw: Any) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None

    location: Dict[str, Any] = {}
    geo_point = _parse_geojson_point(raw.get("coordinates"))

    city = _clean_text(raw.get("city") or raw.get("cityName"), 120)
    if city:
        location["city"] = city

    state = _clean_text(raw.get("state") or raw.get("stateName"), 120)
    if state:
        location["state"] = state

    state_code = _clean_text(raw.get("stateCode") or raw.get("state_code"), 20)
    if state_code:
        location["stateCode"] = state_code.upper() if len(state_code) <= 10 else state_code

    country_code_input = (
        raw.get("countryCode")
        or raw.get("country_code")
        or raw.get("countryISO")
        or raw.get("countryIso")
    )
    country_code = _clean_text(country_code_input, 10)
    if country_code:
        if len(country_code) <= 3:
            location["countryCode"] = country_code.upper()
        else:
            location["countryCode"] = country_code

    country_name = _clean_text(
        raw.get("country") or raw.get("countryName") or raw.get("country_name"),
        120,
    )
    if country_name:
        if len(country_name) <= 3 and country_name.isalpha():
            if "countryCode" not in location:
                location["countryCode"] = country_name.upper()
        else:
            location["country"] = country_name

    formatted = _clean_text(raw.get("formatted"), 180)
    if formatted:
        location["formatted"] = formatted

    lat = _coerce_float(raw.get("lat") or raw.get("latitude"), min_val=-90.0, max_val=90.0)
    if lat is None and geo_point:
        lat = geo_point.get("lat")
    if lat is not None:
        location["lat"] = lat

    lon = _coerce_float(
        raw.get("lon") or raw.get("lng") or raw.get("longitude"),
        min_val=-180.0,
        max_val=180.0,
    )
    if lon is None and geo_point:
        lon = geo_point.get("lon")
    if lon is not None:
        location["lon"] = lon

    if lat is not None and lon is not None:
        location["coordinates"] = _build_geojson_point(lat, lon)

    accuracy = _coerce_float(raw.get("accuracy"), min_val=0.0)
    if accuracy is not None:
        location["accuracy"] = accuracy

    return location or None


def _canonical_smoking(value: Any) -> Optional[str]:
    text = _clean_text(value, 80)
    if not text:
        return None
    lower = text.lower()
    if "don't" in lower or "dont" in lower or "non" in lower:
        return "Don't smoke"
    if "occasion" in lower:
        return "Occasionally smoke"
    if "smoke" in lower:
        return "Do smoke"
    return text


def _canonical_drinking(value: Any) -> Optional[str]:
    text = _clean_text(value, 80)
    if not text:
        return None
    lower = text.lower()
    if "don't" in lower or "dont" in lower or "non" in lower:
        return "Don't drink"
    if "occasion" in lower or "social" in lower:
        return "Occasionally drink"
    if "drink" in lower:
        return "Do drink"
    return text


def _canonical_children(value: Any) -> Optional[str]:
    text = _clean_text(value, 120)
    if not text:
        return None
    lower = text.lower()
    if lower.startswith("no") or "none" in lower:
        return "No"
    if "don't live" in lower or "dont live" in lower or "separate" in lower:
        return "Yes - we don't live together"
    if "live together" in lower or "same home" in lower or "with me" in lower:
        return "Yes - we live together"
    return text


def _canonical_relocation(value: Any) -> Optional[str]:
    text = _clean_text(value, 120)
    if not text:
        return None
    lower = text.lower()
    if "within" in lower and "country" in lower:
        return "Willing to relocate within my country"
    if "another country" in lower or "abroad" in lower or "international" in lower:
        return "Willing to relocate to another country"
    if lower.startswith("not") and "willing" in lower:
        return "Not willing to relocate"
    if "not sure" in lower or "unsure" in lower:
        return "Not sure about relocating"
    return text


def _collect_relationships(doc: Dict[str, Any]) -> Tuple[Set[str], List[str]]:
    seen: Dict[str, str] = {}
    for key in (
        "relationshipLookingFor",
        "relationshipsLookingFor",
        "relationshipPreference",
    ):
        values = _canonical_relationship_list(doc.get(key))
        for value in values:
            if not value:
                continue
            normalized = value.strip()
            if not normalized:
                continue
            lower = normalized.lower()
            if lower not in seen:
                seen[lower] = normalized
    return set(seen.keys()), list(seen.values())


def _extract_lifestyle(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "smoking": _canonical_smoking(doc.get("smoking")),
        "drinking": _canonical_drinking(doc.get("drinking")),
        "children": _canonical_children(doc.get("children")),
        "relocation": _canonical_relocation(doc.get("relocation")),
        "childrenCount": _coerce_int(doc.get("childrenCount"), min_val=0, max_val=20),
    }


def _prepare_match_profile(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc or not isinstance(doc, dict):
        return None
    if not _has_visible_dating_profile(doc):
        return None

    location_raw = doc.get("location") if isinstance(doc.get("location"), dict) else None
    if not isinstance(location_raw, dict):
        location_raw = {}

    city = _clean_text(location_raw.get("city"), 160)
    state = _clean_text(location_raw.get("state"), 160)
    country = _clean_text(location_raw.get("country"), 160)

    lat = _coerce_float(location_raw.get("lat"), min_val=-90.0, max_val=90.0)
    lon = _coerce_float(location_raw.get("lon"), min_val=-180.0, max_val=180.0)
    if (lat is None or lon is None) and isinstance(location_raw.get("coordinates"), dict):
        coords = _parse_geojson_point(location_raw.get("coordinates"))
        if coords:
            if lat is None:
                lat = coords.get("lat")
            if lon is None:
                lon = coords.get("lon")

    relationships_lower, relationships_all = _collect_relationships(doc)

    preferences_age: Optional[Dict[str, int]] = None
    prefs = doc.get("preferences")
    if isinstance(prefs, dict):
        age_pref = prefs.get("age")
        if isinstance(age_pref, dict):
            min_age = _coerce_int(age_pref.get("min"), min_val=18, max_val=120)
            max_age = _coerce_int(age_pref.get("max"), min_val=18, max_val=120)
            if min_age is not None or max_age is not None:
                if min_age is not None and max_age is not None and min_age > max_age:
                    min_age, max_age = max_age, min_age
                preferences_age = {}
                if min_age is not None:
                    preferences_age["min"] = min_age
                if max_age is not None:
                    preferences_age["max"] = max_age

    lifestyle = _extract_lifestyle(doc)

    keyword_sources = [doc.get(field) for field in PROFILE_KEYWORD_FIELDS]
    keywords = _tokenize_keywords(*keyword_sources)

    user_id = str(doc.get("userId") or "").strip()

    return {
        "userId": user_id,
        "age": _coerce_int(doc.get("age"), min_val=18, max_val=120),
        "gender": _canonical_gender(doc.get("gender")),
        "interested_in": _canonical_interest(doc.get("interestedIn")),
        "religion": _clean_text(doc.get("religion"), 80),
        "body_type": _clean_text(doc.get("bodyType"), 80),
        "relationships_lower": relationships_lower,
        "relationships_all": relationships_all,
        "preferences": {"age": preferences_age} if preferences_age else {},
        "location": {
            "lat": lat,
            "lon": lon,
            "city": (city or "").lower(),
            "state": (state or "").lower(),
            "country": (country or "").lower(),
            "city_label": city,
            "state_label": state,
            "country_label": country,
        },
        "lifestyle": lifestyle,
        "keywords": keywords,
    }


def _score_location(viewer: Dict[str, Any], other: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    weight = 30.0
    viewer_loc = viewer.get("location") or {}
    other_loc = other.get("location") or {}
    lat_v = viewer_loc.get("lat")
    lon_v = viewer_loc.get("lon")
    lat_o = other_loc.get("lat")
    lon_o = other_loc.get("lon")
    distance_km: Optional[float] = None
    level: Optional[str] = None
    score = 0.0

    if (
        isinstance(lat_v, (int, float))
        and isinstance(lon_v, (int, float))
        and isinstance(lat_o, (int, float))
        and isinstance(lon_o, (int, float))
    ):
        distance_m = _haversine_distance_m(lat_v, lon_v, lat_o, lon_o)
        if distance_m is not None and math.isfinite(distance_m):
            distance_km = distance_m / 1000.0
            if distance_km <= 25.0:
                score = weight
                level = "same-area"
            elif distance_km <= 100.0:
                score = 26.0
                level = "nearby"
            elif distance_km <= 250.0:
                score = 22.0
                level = "regional"
            elif distance_km <= 500.0:
                score = 18.0
                level = "same-state"
            elif distance_km <= 1500.0:
                score = 12.0
                level = "same-country"
            else:
                score = 6.0
                level = "distant"

    if score == 0.0:
        city_v = viewer_loc.get("city")
        city_o = other_loc.get("city")
        state_v = viewer_loc.get("state")
        state_o = other_loc.get("state")
        country_v = viewer_loc.get("country")
        country_o = other_loc.get("country")
        if city_v and city_o and city_v == city_o:
            score = 26.0
            level = "same-city"
        elif state_v and state_o and state_v == state_o:
            score = 20.0
            level = "same-state"
        elif country_v and country_o and country_v == country_o:
            score = 12.0
            level = "same-country"

    meta = {"distanceKm": distance_km, "level": level}
    return min(score, weight), meta


def _score_relationships(viewer: Dict[str, Any], other: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    weight = 25.0
    viewer_set: Set[str] = viewer.get("relationships_lower") or set()
    other_set: Set[str] = other.get("relationships_lower") or set()
    if not viewer_set or not other_set:
        return 0.0, {"overlap": []}
    overlap = viewer_set & other_set
    if not overlap:
        return 0.0, {"overlap": []}
    union = viewer_set | other_set
    ratio = len(overlap) / float(len(union)) if union else 0.0
    lookup: Dict[str, str] = {}
    for value in viewer.get("relationships_all", []):
        if isinstance(value, str):
            lookup[value.lower()] = value
    for value in other.get("relationships_all", []):
        if isinstance(value, str):
            lookup.setdefault(value.lower(), value)
    overlap_labels = [lookup.get(item, item.title()) for item in sorted(overlap)]
    meta = {"overlap": overlap_labels, "ratio": ratio}
    return min(ratio * weight, weight), meta


def _score_interest(viewer: Dict[str, Any], other: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    weight = 20.0
    score = 0.0
    mutual: List[str] = []

    viewer_interest = viewer.get("interested_in")
    other_gender = other.get("gender")
    if viewer_interest and other_gender:
        if viewer_interest.lower() == "everyone" or viewer_interest == other_gender:
            score += 10.0
            mutual.append("viewer")

    other_interest = other.get("interested_in")
    viewer_gender = viewer.get("gender")
    if other_interest and viewer_gender:
        if other_interest.lower() == "everyone" or other_interest == viewer_gender:
            score += 10.0
            mutual.append("other")

    religion_match = False
    viewer_rel = (viewer.get("religion") or "").strip().lower() if viewer.get("religion") else ""
    other_rel = (other.get("religion") or "").strip().lower() if other.get("religion") else ""
    if viewer_rel and other_rel and viewer_rel == other_rel:
        score += 5.0
        religion_match = True

    age_notes: List[str] = []
    viewer_pref_age = (viewer.get("preferences") or {}).get("age")
    other_age = other.get("age")
    if isinstance(viewer_pref_age, dict) and other_age is not None:
        min_age = viewer_pref_age.get("min")
        max_age = viewer_pref_age.get("max")
        if min_age is not None and max_age is not None:
            if min_age <= other_age <= max_age:
                score += 5.0
                age_notes.append("viewer-range")
            else:
                boundary_diff = min(abs(other_age - min_age), abs(other_age - max_age))
                if boundary_diff <= 2:
                    score += 2.0
                    age_notes.append("viewer-near")
        elif min_age is not None and other_age >= min_age:
            score += 3.0
            age_notes.append("viewer-min")
        elif max_age is not None and other_age <= max_age:
            score += 3.0
            age_notes.append("viewer-max")

    viewer_age = viewer.get("age")
    other_pref_age = (other.get("preferences") or {}).get("age")
    if isinstance(other_pref_age, dict) and viewer_age is not None:
        min_age = other_pref_age.get("min")
        max_age = other_pref_age.get("max")
        if min_age is not None and max_age is not None:
            if min_age <= viewer_age <= max_age:
                score += 5.0
                age_notes.append("other-range")
            else:
                boundary_diff = min(abs(viewer_age - min_age), abs(viewer_age - max_age))
                if boundary_diff <= 2:
                    score += 2.0
                    age_notes.append("other-near")
        elif min_age is not None and viewer_age >= min_age:
            score += 3.0
            age_notes.append("other-min")
        elif max_age is not None and viewer_age <= max_age:
            score += 3.0
            age_notes.append("other-max")

    meta = {
        "mutual": mutual,
        "religionMatch": religion_match,
        "ageCompatibility": age_notes,
    }
    return min(score, weight), meta


def _score_lifestyle(viewer: Dict[str, Any], other: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    weight = 15.0
    viewer_life = viewer.get("lifestyle") or {}
    other_life = other.get("lifestyle") or {}
    score = 0.0
    matches: List[str] = []

    weights = {
        "smoking": 4.0,
        "drinking": 4.0,
        "children": 3.0,
        "relocation": 3.0,
    }
    for key, value in weights.items():
        v_val = viewer_life.get(key)
        o_val = other_life.get(key)
        if v_val and o_val and v_val == o_val:
            score += value
            matches.append(key)

    v_children_count = viewer_life.get("childrenCount")
    o_children_count = other_life.get("childrenCount")
    if isinstance(v_children_count, int) and isinstance(o_children_count, int):
        if v_children_count == o_children_count:
            score += 2.0
            matches.append("childrenCount")
        elif abs(v_children_count - o_children_count) <= 1:
            score += 1.0
            matches.append("childrenCountClose")

    meta = {"matches": matches}
    return min(score, weight), meta


def _score_personality(viewer: Dict[str, Any], other: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    weight = 10.0
    viewer_tokens: Set[str] = viewer.get("keywords") or set()
    other_tokens: Set[str] = other.get("keywords") or set()
    if not viewer_tokens or not other_tokens:
        return 0.0, {"overlap": []}
    intersection = viewer_tokens & other_tokens
    if not intersection:
        return 0.0, {"overlap": []}
    union = viewer_tokens | other_tokens
    if not union:
        return 0.0, {"overlap": []}
    ratio = len(intersection) / float(len(union))
    meta = {
        "overlap": sorted(intersection)[:12],
        "ratio": ratio,
    }
    return min(ratio * weight, weight), meta


def _format_component(score: float, weight: int, meta: Dict[str, Any]) -> Dict[str, Any]:
    clamped = max(0.0, min(float(weight), float(score)))
    data: Dict[str, Any] = {"score": int(round(clamped)), "weight": weight}
    for key, value in meta.items():
        if value is None:
            continue
        if isinstance(value, set):
            data[key] = sorted(value)
        elif isinstance(value, (list, tuple)):
            data[key] = list(value)
        elif isinstance(value, float):
            data[key] = round(value, 3)
        else:
            data[key] = value
    return data


def _compute_match_breakdown(
    viewer_profile: Dict[str, Any], other_doc: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    other_profile = _prepare_match_profile(other_doc)
    if not other_profile:
        return None

    location_score, location_meta = _score_location(viewer_profile, other_profile)
    relationship_score, relationship_meta = _score_relationships(viewer_profile, other_profile)
    interest_score, interest_meta = _score_interest(viewer_profile, other_profile)
    lifestyle_score, lifestyle_meta = _score_lifestyle(viewer_profile, other_profile)
    personality_score, personality_meta = _score_personality(viewer_profile, other_profile)

    components_raw = {
        "location": (location_score, 30, location_meta),
        "relationship": (relationship_score, 25, relationship_meta),
        "interests": (interest_score, 20, interest_meta),
        "lifestyle": (lifestyle_score, 15, lifestyle_meta),
        "personality": (personality_score, 10, personality_meta),
    }

    formatted_components: Dict[str, Dict[str, Any]] = {}
    total_score = 0
    for name, (raw_score, weight, meta) in components_raw.items():
        comp = _format_component(raw_score, weight, meta)
        formatted_components[name] = comp
        total_score += comp.get("score", 0)

    final_score = total_score if total_score > 0 else 10
    if final_score < 10:
        final_score = 10
    if final_score > 100:
        final_score = 100

    breakdown = {
        "total": int(final_score),
        "rawTotal": total_score,
        "components": formatted_components,
    }
    return breakdown


async def _resolve_viewer_profile(
    request: Request,
) -> Optional[Dict[str, Any]]:
    authorization = request.headers.get("authorization") or request.headers.get("Authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        profile = await get_current_profile(token)
    except Exception:
        return None
    if not profile or not isinstance(profile, dict):
        return None
    sanitized = dict(profile)
    sanitized.pop("_id", None)
    sanitized.pop("passwordHash", None)
    return sanitized


router = APIRouter()

@router.get("/dating/profiles")
async def list_profiles(
    request: Request,
    limit: int = Query(default=2000, ge=1, le=2000),
    viewer_id: Optional[str] = Query(default=None, alias="viewerId"),
    viewer_lat: Optional[float] = Query(default=None, alias="viewerLat", ge=-90.0, le=90.0),
    viewer_lon: Optional[float] = Query(default=None, alias="viewerLon", ge=-180.0, le=180.0),
    max_distance_km: Optional[float] = Query(default=None, alias="maxDistanceKm", ge=0.1, le=25_000.0),
) -> List[Dict]:
    db = get_dating_db()
    docs = await db[DATING_PROFILES_COLLECTION].find({}).limit(int(limit)).to_list(length=int(limit))

    viewer_profile = await _resolve_viewer_profile(request)
    if not viewer_profile and viewer_id:
        candidate_id = viewer_id.strip()
        if candidate_id:
            profile_doc = await db[DATING_PROFILES_COLLECTION].find_one({"userId": candidate_id})
            if isinstance(profile_doc, dict):
                viewer_profile = dict(profile_doc)
                viewer_profile.pop("_id", None)

    if isinstance(viewer_profile, dict):
        _synchronize_name_fields(viewer_profile)

    viewer_match_profile = _prepare_match_profile(viewer_profile) if viewer_profile else None
    derived_lat = viewer_match_profile.get("location", {}).get("lat") if viewer_match_profile else None
    derived_lon = viewer_match_profile.get("location", {}).get("lon") if viewer_match_profile else None
    base_viewer_lat = viewer_lat if viewer_lat is not None else derived_lat
    base_viewer_lon = viewer_lon if viewer_lon is not None else derived_lon

    has_viewer_coords = isinstance(base_viewer_lat, (int, float)) and isinstance(base_viewer_lon, (int, float))
    max_distance_m: Optional[float] = None
    if has_viewer_coords and max_distance_km is not None:
        try:
            max_distance_m = max(0.0, float(max_distance_km) * 1000.0)
        except (TypeError, ValueError):
            max_distance_m = None

    filtered: List[Dict] = []

    for raw_doc in docs:
        if not isinstance(raw_doc, dict):
            continue
        doc = dict(raw_doc)
        doc.pop("_id", None)
        _synchronize_name_fields(doc)
        if not _has_visible_dating_profile(doc):
            continue

        if has_viewer_coords:
            distance_m: Optional[float] = None
            loc = doc.get("location")
            lat_val = None
            lon_val = None
            if isinstance(loc, dict):
                lat_val = loc.get("lat")
                lon_val = loc.get("lon")
                if not isinstance(lat_val, (int, float)):
                    lat_val = _coerce_float(lat_val, min_val=-90.0, max_val=90.0)
                if not isinstance(lon_val, (int, float)):
                    lon_val = _coerce_float(lon_val, min_val=-180.0, max_val=180.0)
                if (lat_val is None or lon_val is None) and isinstance(loc.get("coordinates"), dict):
                    parsed = _parse_geojson_point(loc.get("coordinates"))
                    if parsed:
                        if lat_val is None:
                            lat_val = parsed.get("lat")
                        if lon_val is None:
                            lon_val = parsed.get("lon")
            distance_m = _haversine_distance_m(base_viewer_lat, base_viewer_lon, lat_val, lon_val)
            if max_distance_m is not None:
                if distance_m is None or not math.isfinite(distance_m) or distance_m > max_distance_m:
                    continue
            if distance_m is not None and math.isfinite(distance_m):
                doc["distanceMeters"] = float(distance_m)

        if viewer_match_profile:
            viewer_user_id = (viewer_match_profile.get("userId") or "").strip()
            candidate_user_id = str(doc.get("userId") or "").strip()
            if not viewer_user_id or viewer_user_id != candidate_user_id:
                breakdown = _compute_match_breakdown(viewer_match_profile, doc)
                if breakdown:
                    doc["matchBreakdown"] = breakdown
                    doc["matchPercentage"] = breakdown.get("total")

        _apply_primary_photo_metadata(doc)
        doc.pop("hasDatingProfile", None)
        filtered.append(doc)

    if has_viewer_coords:
        filtered.sort(key=lambda item: item.get("distanceMeters", float("inf")))

    return filtered


@router.get("/dating/profiles/batch")
async def batch_profiles(
    request: Request,
    response: Response,
    users: str = "",
    ids: str = "",
) -> List[Dict]:
    name_entries = [u.strip() for u in (users or "").split(",") if u.strip()]
    id_entries = [i.strip() for i in (ids or "").split(",") if i.strip()]

    if not name_entries and not id_entries:
        return []

    key_parts: List[str] = []
    if name_entries:
        key_parts.append("u:" + ",".join(sorted(name_entries)))
    if id_entries:
        key_parts.append("i:" + ",".join(sorted(id_entries)))
    cache_key = f"profiles:batch:{'|'.join(key_parts)}"
    try:
        inm = request.headers.get("if-none-match")
    except Exception:
        inm = None

    cached = await local_cache.get(cache_key) if cache_key else None
    if cached is not None:
        try:
            raw = json.dumps(cached, separators=(",", ":"), sort_keys=True)
            response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=120"
            tag = _etag_for(raw)
            response.headers["ETag"] = tag
            if inm and inm == tag:
                response.status_code = 304
                return []
        except Exception:
            pass
        return cached

    dating_db = get_dating_db()
    user_db = get_user_db()

    name_to_user_id: Dict[str, str] = {}
    if name_entries:
        lowers = [entry.lower() for entry in name_entries]
        try:
            cursor = user_db[USER_PROFILES_COLLECTION].find({"usernameLower": {"$in": lowers}})
            async for profile in cursor:
                uid = str(profile.get("userId") or "").strip()
                uname_lower = str(profile.get("usernameLower") or "").strip().lower()
                if uid and uname_lower:
                    name_to_user_id[uname_lower] = uid
        except Exception:
            name_to_user_id = {}

    ordered_user_ids: List[str] = []
    seen_ids: Set[str] = set()

    def _track(user_id: Optional[str]) -> None:
        if not user_id:
            return
        cleaned = user_id.strip()
        if not cleaned or cleaned in seen_ids:
            return
        seen_ids.add(cleaned)
        ordered_user_ids.append(cleaned)

    for identifier in id_entries:
        _track(identifier)

    for name in name_entries:
        resolved = name_to_user_id.get(name.lower())
        _track(resolved)

    query_user_ids: Set[str] = set(ordered_user_ids)
    if not query_user_ids:
        return []

    docs = await dating_db[DATING_PROFILES_COLLECTION].find({"userId": {"$in": list(query_user_ids)}}).to_list(length=2000)

    doc_lookup: Dict[str, Dict[str, Any]] = {}
    for raw_doc in docs:
        if not isinstance(raw_doc, dict):
            continue
        doc = dict(raw_doc)
        doc.pop("_id", None)
        _synchronize_name_fields(doc)
        is_visible = _has_visible_dating_profile(doc)
        doc.pop("hasDatingProfile", None)
        _apply_primary_photo_metadata(doc)
        uid = str(doc.get("userId") or "").strip()
        if uid:
            doc_lookup[uid] = doc

    ordered_docs: List[Dict] = []
    for user_id in ordered_user_ids:
        doc = doc_lookup.get(user_id)
        if doc:
            ordered_docs.append(doc)

    for user_id, document in doc_lookup.items():
        if user_id not in seen_ids:
            ordered_docs.append(document)

    if cache_key:
        await local_cache.set(cache_key, ordered_docs, ttl_seconds=30)
    try:
        raw = json.dumps(ordered_docs, separators=(",", ":"), sort_keys=True)
        response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=120"
        response.headers["ETag"] = _etag_for(raw)
    except Exception:
        pass
    return ordered_docs

@router.put("/dating/profile")
async def upsert_profile(payload: Dict[str, Any]) -> Dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    dating_db = get_dating_db()
    user_db = get_user_db()

    raw_user_id = payload.get("userId")
    if not isinstance(raw_user_id, str) or not raw_user_id.strip():
        raise HTTPException(status_code=400, detail="userId required")
    user_id = raw_user_id.strip()

    user_doc = await user_db[USER_PROFILES_COLLECTION].find_one({"userId": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="user profile not found")

    body = {key: value for key, value in payload.items() if key in ALLOWED_UPSERT_FIELDS}

    raw_user_profile_id = user_doc.get("_id")
    if raw_user_profile_id is None:
        raise HTTPException(status_code=400, detail="user profile invalid")
    user_profile_id = (
        str(raw_user_profile_id)
        if isinstance(raw_user_profile_id, ObjectId)
        else raw_user_profile_id
    )

    existing_doc = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": user_id}) or {}
    if isinstance(existing_doc, dict):
        existing_doc.pop("_id", None)
        for legacy_key in ("username", "usernameLower", "displayName", "name", "photo", "photoUrl", "hasDatingProfile"):
            existing_doc.pop(legacy_key, None)

    # Normalize numeric age if provided
    if "age" in body:
        age_val = body.get("age")
        if age_val is None or age_val == "":
            body.pop("age", None)
        else:
            try:
                age_int = int(age_val)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="age must be a number")
            if age_int < 18 or age_int > 120:
                raise HTTPException(status_code=400, detail="age must be between 18 and 120")
            body["age"] = age_int

    # Allow stripping helper field
    body.pop("ageNumber", None)

    gender = _canonical_gender(body.get("gender"))
    if gender:
        body["gender"] = gender
    elif "gender" in body:
        body.pop("gender", None)

    interested = _canonical_interest(body.get("interestedIn"))
    if interested:
        body["interestedIn"] = interested
    elif "interestedIn" in body:
        body.pop("interestedIn", None)

    canonical_name = _clean_text(body.get("firstName"), 80)
    if not canonical_name and isinstance(existing_doc, dict):
        canonical_name = _clean_text(existing_doc.get("firstName"), 80)
    if not canonical_name:
        canonical_name = _clean_text(payload.get("firstName"), 80)
    if not canonical_name:
        raise HTTPException(status_code=400, detail="firstName required")
    body["firstName"] = canonical_name

    # Clear any legacy name fields that might have slipped through
    for legacy_name in ("displayName", "name", "username", "usernameLower"):
        body.pop(legacy_name, None)

    if "location" in body:
        normalized_location = _normalize_location(body.get("location"))
        existing_location = existing_doc.get("location") if isinstance(existing_doc, dict) else None
        if normalized_location is not None:
            if isinstance(existing_location, dict):
                if "lat" not in normalized_location:
                    prev_lat = _coerce_float(existing_location.get("lat"), min_val=-90.0, max_val=90.0)
                    if prev_lat is not None:
                        normalized_location["lat"] = prev_lat
                if "lon" not in normalized_location:
                    prev_lon = _coerce_float(existing_location.get("lon"), min_val=-180.0, max_val=180.0)
                    if prev_lon is not None:
                        normalized_location["lon"] = prev_lon
                if "coordinates" not in normalized_location and isinstance(existing_location.get("coordinates"), dict):
                    coords = _parse_geojson_point(existing_location.get("coordinates"))
                    if coords and "lat" not in normalized_location:
                        normalized_location["lat"] = coords.get("lat")
                    if coords and "lon" not in normalized_location:
                        normalized_location["lon"] = coords.get("lon")

            lat_val = normalized_location.get("lat")
            lon_val = normalized_location.get("lon")
            if isinstance(lat_val, (int, float)) and isinstance(lon_val, (int, float)):
                normalized_location["coordinates"] = _build_geojson_point(lat_val, lon_val)
            elif "coordinates" in normalized_location:
                normalized_location.pop("coordinates", None)

        body["location"] = normalized_location

    if "preferences" in body:
        raw_preferences = body.get("preferences")
        normalized_preferences = _normalize_preferences(raw_preferences)
        if normalized_preferences is not None:
            body["preferences"] = normalized_preferences
        elif isinstance(raw_preferences, dict) and not raw_preferences:
            body["preferences"] = {}
        else:
            body.pop("preferences", None)

    # Canonicalize relationship fields from onboarding flow
    relationship_fields = [
        "relationshipLookingFor",
        "relationshipPreference",
        "relationshipsLookingFor",
    ]
    for key in relationship_fields:
        if key in body:
            raw_value = body.get(key)
            relations = _canonical_relationship_list(raw_value)
            if relations or (isinstance(raw_value, (list, tuple, set)) and not relations):
                body[key] = relations
            else:
                body.pop(key, None) 

    if "smoking" in body:
        body["smoking"] = _canonical_smoking(body.get("smoking"))
    if "drinking" in body:
        body["drinking"] = _canonical_drinking(body.get("drinking"))
    if "relocation" in body:
        body["relocation"] = _canonical_relocation(body.get("relocation"))
    if "children" in body:
        body["children"] = _canonical_children(body.get("children"))
    if "childrenCount" in body:
        count_val = _coerce_int(body.get("childrenCount"), min_val=0, max_val=20)
        body["childrenCount"] = count_val if count_val is not None else None

    if "religion" in body:
        body["religion"] = _clean_text(body.get("religion"), 80)
    if "nationality" in body:
        body["nationality"] = _clean_text(body.get("nationality"), 80)
    if "bodyType" in body:
        body["bodyType"] = _clean_text(body.get("bodyType"), 80)

    for key, limit in PROFILE_TEXT_FIELD_LIMITS.items():
        if key in body:
            body[key] = _clean_text(body.get(key), limit)

    if "mood" in body:
        mood_value = _clean_text(body.get("mood"), 160)
        if mood_value:
            body["mood"] = mood_value
        else:
            body.pop("mood", None)

    primary_photo_override: Optional[str] = None
    photos_in_payload = "photos" in body
    existing_photos_list: List[str] = []
    existing_primary = None
    if isinstance(existing_doc, dict):
        raw_existing_photos = existing_doc.get("photos")
        if isinstance(raw_existing_photos, list):
            existing_photos_list = [
                entry for entry in raw_existing_photos if isinstance(entry, str) and entry.strip()
            ]
        primary_candidate_existing = existing_doc.get("primaryPhotoUrl") or existing_doc.get("photoUrl") or existing_doc.get("photo")
        if isinstance(primary_candidate_existing, str) and primary_candidate_existing.strip():
            existing_primary = primary_candidate_existing.strip()
            existing_photos_list = [entry for entry in existing_photos_list if entry != existing_primary]

    if photos_in_payload:
        sanitized_photos = _normalize_photos(body.get("photos"), allow_empty=True)
        if sanitized_photos is not None:
            body["photos"] = sanitized_photos
            primary_photo_override = sanitized_photos[0] if sanitized_photos else None
        else:
            body.pop("photos", None)

    if photos_in_payload and not isinstance(body.get("photos"), list):
        photos_in_payload = False

    def _resolve_photo_field(field_name: str, fallback: Optional[str]) -> Optional[str]:
        if field_name in body:
            return _clean_url(body.get(field_name))
        return fallback

    resolved_photo_url: Optional[str] = None
    if photos_in_payload or "photoUrl" in body:
        resolved_photo_url = _resolve_photo_field("photoUrl", primary_photo_override)
        body["photoUrl"] = resolved_photo_url if resolved_photo_url else None

    if photos_in_payload or "photo" in body:
        resolved_photo_field = _resolve_photo_field("photo", primary_photo_override or resolved_photo_url)
        body["photo"] = resolved_photo_field if resolved_photo_field else None

    photos_list = body.get("photos") if isinstance(body.get("photos"), list) else None

    primary_candidate: Optional[str] = None
    explicit_primary_clear = False

    if "primaryPhotoUrl" in body:
        raw_primary = body.get("primaryPhotoUrl")
        if isinstance(raw_primary, str):
            cleaned_primary = _clean_url(raw_primary)
            if cleaned_primary:
                primary_candidate = cleaned_primary
            else:
                explicit_primary_clear = True
        elif raw_primary is None:
            explicit_primary_clear = True
        body.pop("primaryPhotoUrl", None)

    if "photoUrl" in body:
        candidate = body.get("photoUrl")
        if isinstance(candidate, str):
            trimmed = candidate.strip()
            if trimmed:
                primary_candidate = trimmed
            else:
                explicit_primary_clear = True
        elif candidate is None:
            explicit_primary_clear = True

    if primary_candidate is None and "photo" in body:
        candidate = body.get("photo")
        if isinstance(candidate, str):
            trimmed = candidate.strip()
            if trimmed:
                primary_candidate = trimmed
            else:
                explicit_primary_clear = True
        elif candidate is None:
            explicit_primary_clear = True

    if primary_candidate is None and isinstance(photos_list, list):
        for entry in photos_list:
            if not isinstance(entry, str):
                continue
            trimmed = entry.strip()
            if trimmed:
                primary_candidate = trimmed
                break
        if photos_in_payload and not photos_list:
            explicit_primary_clear = True

    if primary_candidate is None and not explicit_primary_clear:
        primary_candidate = existing_primary

    if primary_candidate is not None or explicit_primary_clear:
        body["primaryPhotoUrl"] = primary_candidate if primary_candidate else None

    primary_current = primary_candidate

    if isinstance(body.get("photos"), list):
        filtered_photos: List[str] = []
        seen_photos: Set[str] = set()
        for entry in body.get("photos", []):
            if not isinstance(entry, str):
                continue
            trimmed = entry.strip()
            if not trimmed:
                continue
            if primary_current and trimmed == primary_current:
                continue
            if trimmed in seen_photos:
                continue
            seen_photos.add(trimmed)
            filtered_photos.append(trimmed)
        body["photos"] = filtered_photos

    allowed_photo_values: List[str]
    if isinstance(body.get("photos"), list):
        allowed_photo_values = body["photos"]
    else:
        allowed_photo_values = existing_photos_list

    placements_in_payload = "photoPlacements" in body
    if placements_in_payload:
        raw_placements = body.get("photoPlacements")
        if raw_placements is None:
            body["photoPlacements"] = {}
        else:
            normalized_placements = _normalize_photo_placements(raw_placements, allowed_photo_values)
            if primary_current:
                normalized_placements = {
                    key: value for key, value in normalized_placements.items() if key != primary_current
                }
            if normalized_placements:
                body["photoPlacements"] = normalized_placements
            elif isinstance(raw_placements, dict):
                body["photoPlacements"] = {}
            else:
                body.pop("photoPlacements", None)
    elif photos_in_payload:
        existing_placements_raw = existing_doc.get("photoPlacements") if isinstance(existing_doc, dict) else None
        if isinstance(existing_placements_raw, dict):
            normalized_existing_placements = _normalize_photo_placements(existing_placements_raw, allowed_photo_values)
            if primary_current:
                normalized_existing_placements = {
                    key: value for key, value in normalized_existing_placements.items() if key != primary_current
                }
            if normalized_existing_placements:
                body["photoPlacements"] = normalized_existing_placements
            elif existing_placements_raw:
                body["photoPlacements"] = {}

    now_ms = int(time.time() * 1000)
    body.pop("createdAt", None)
    body["updatedAt"] = now_ms

    body["userId"] = user_id
    body["userProfileId"] = user_profile_id

    merged_doc: Dict[str, Any] = dict(existing_doc) if isinstance(existing_doc, dict) else {}
    for key, value in body.items():
        merged_doc[key] = value
    has_profile = _has_visible_dating_profile(merged_doc)

    unset_payload: Dict[str, int] = {}
    for legacy_field in LEGACY_PROFILE_FIELDS:
        if legacy_field in existing_doc:
            unset_payload[legacy_field] = 1
    for legacy_key in ("username", "usernameLower", "displayName", "name", "photo", "photoUrl", "hasDatingProfile"):
        unset_payload[legacy_key] = 1
        body.pop(legacy_key, None)
    if has_profile:
        if not existing_doc.get("datingProfileCreatedAt") and "datingProfileCreatedAt" not in body:
            body["datingProfileCreatedAt"] = now_ms
    else:
        unset_payload["datingProfileCreatedAt"] = 1

    try:
        update_spec: Dict[str, Any] = {
            "$set": body,
            "$setOnInsert": {"createdAt": now_ms},
        }
        if unset_payload:
            update_spec["$unset"] = unset_payload
        await dating_db[DATING_PROFILES_COLLECTION].update_one(
            {"userId": user_id},
            update_spec,
            upsert=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="failed to save profile") from exc

    doc = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": user_id}) or {}
    doc.pop("_id", None)
    _apply_primary_photo_metadata(doc)
    _synchronize_name_fields(doc)
    doc.pop("hasDatingProfile", None)

    if has_profile:
        await user_db[USER_PROFILES_COLLECTION].update_one(
            {"userId": user_id},
            {"$set": {"hasDatingProfile": True}},
        )
    else:
        await user_db[USER_PROFILES_COLLECTION].update_one(
            {"userId": user_id},
            {"$unset": {"hasDatingProfile": ""}},
        )

    doc["userId"] = user_id
    doc["userProfileId"] = user_profile_id

    try:
        await local_cache.delete_prefix("profiles:batch:")
        await publish_invalidate("profiles:batch:")
    except Exception:
        pass

    return doc

@router.delete("/dating/profile/{user_id}")
async def delete_profile(user_id: str):
    normalized_user_id = (user_id or "").strip()
    if not normalized_user_id:
        raise HTTPException(status_code=400, detail="userId required")

    dating_db = get_dating_db()
    user_db = get_user_db()
    db = get_db()

    doc = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": normalized_user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")

    now_ms = int(time.time() * 1000)
    unset_keys = {field: 1 for field in PROFILE_CLEAR_FIELDS}
    await dating_db[DATING_PROFILES_COLLECTION].update_one(
        {"userId": normalized_user_id},
        {
            "$set": {
                "updatedAt": now_ms,
                "userId": normalized_user_id,
            },
            "$unset": unset_keys,
        },
    )

    await user_db[USER_PROFILES_COLLECTION].update_one(
        {"userId": normalized_user_id},
        {"$unset": {"hasDatingProfile": ""}},
    )

    await db[LIKES_COLLECTION].delete_many(
        {"$or": [{"liker_id": normalized_user_id}, {"liked_id": normalized_user_id}]}
    )

    try:
        await local_cache.delete_prefix("profiles:batch:")
        await publish_invalidate("profiles:batch:")
    except Exception:
        pass

    return {"success": True}


@router.get("/dating/profile/{user_id}/photos")
async def get_profile_secondary_photos(user_id: str) -> Dict[str, Any]:
    normalized_user_id = (user_id or "").strip()
    if not normalized_user_id:
        raise HTTPException(status_code=400, detail="userId required")

    dating_db = get_dating_db()
    doc = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": normalized_user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")

    payload: Dict[str, Any] = dict(doc)
    payload.pop("_id", None)

    _apply_primary_photo_metadata(payload)
    primary_candidate = payload.get("primaryPhotoUrl") 
    primary_photo = (
        primary_candidate.strip()
        if isinstance(primary_candidate, str) and primary_candidate.strip()
        else None
    )
    payload["photos"] = _collect_secondary_photos(payload, primary=primary_photo)

    _synchronize_name_fields(payload)
    payload.pop("hasDatingProfile", None)
    payload["userId"] = normalized_user_id
    return payload


@router.post("/dating/profile/{user_id}/photos")
async def set_profile_secondary_photos(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized_user_id = (user_id or "").strip()
    if not normalized_user_id:
        raise HTTPException(status_code=400, detail="userId required")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid payload")

    dating_db = get_dating_db()
    existing_doc_raw = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": normalized_user_id})
    if not existing_doc_raw:
        raise HTTPException(status_code=404, detail="Profile not found")

    existing_doc: Dict[str, Any] = dict(existing_doc_raw)
    existing_doc.pop("_id", None)

    _apply_primary_photo_metadata(existing_doc)
    primary_candidate = existing_doc.get("primaryPhotoUrl")
    primary_photo = (
        primary_candidate.strip()
        if isinstance(primary_candidate, str) and primary_candidate.strip()
        else None
    )
    current_photos = _collect_secondary_photos(existing_doc, primary=primary_photo)

    if "photos" in payload:
        try:
            next_photos = _sanitize_secondary_photos_input(
                payload.get("photos"),
                primary=primary_photo,
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"photos cannot exceed {SECONDARY_PHOTO_LIMIT}",
            ) from None
    elif "url" in payload:
        sanitized_url = _clean_url(payload.get("url"))
        if not sanitized_url:
            raise HTTPException(status_code=400, detail="valid url required")
        if primary_photo and sanitized_url == primary_photo:
            raise HTTPException(status_code=400, detail="url matches primary photo")
        next_photos = list(current_photos)
        if sanitized_url not in next_photos:
            next_photos.append(sanitized_url)
    else:
        raise HTTPException(status_code=400, detail="photos payload required")

    if len(next_photos) > SECONDARY_PHOTO_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"photos cannot exceed {SECONDARY_PHOTO_LIMIT}",
        )

    raw_placements = existing_doc.get("photoPlacements")
    normalized_placements = None
    if isinstance(raw_placements, dict):
        normalized_placements = _normalize_photo_placements(raw_placements, next_photos)
        if not normalized_placements:
            normalized_placements = None

    now_ms = int(time.time() * 1000)
    set_payload: Dict[str, Any] = {
        "photos": next_photos,
        "updatedAt": now_ms,
        "userId": normalized_user_id,
    }
    unset_payload: Dict[str, int] = {}

    if normalized_placements is not None:
        set_payload["photoPlacements"] = normalized_placements
    elif isinstance(raw_placements, dict) and raw_placements:
        unset_payload["photoPlacements"] = 1

    update_spec: Dict[str, Any] = {"$set": set_payload}
    if unset_payload:
        update_spec["$unset"] = unset_payload

    await dating_db[DATING_PROFILES_COLLECTION].update_one(
        {"userId": normalized_user_id},
        update_spec,
    )

    updated = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": normalized_user_id}) or {}
    updated.pop("_id", None)

    _apply_primary_photo_metadata(updated)
    primary_updated = updated.get("primaryPhotoUrl")
    normalized_primary = (
        primary_updated.strip()
        if isinstance(primary_updated, str) and primary_updated.strip()
        else None
    )
    updated["photos"] = _collect_secondary_photos(updated, primary=normalized_primary)

    _synchronize_name_fields(updated)
    updated.pop("hasDatingProfile", None)
    updated["userId"] = normalized_user_id

    has_profile = _has_visible_dating_profile(updated)
    user_db = get_user_db()
    if has_profile:
        await user_db[USER_PROFILES_COLLECTION].update_one(
            {"userId": normalized_user_id},
            {"$set": {"hasDatingProfile": True}},
        )
    else:
        await user_db[USER_PROFILES_COLLECTION].update_one(
            {"userId": normalized_user_id},
            {"$unset": {"hasDatingProfile": ""}},
        )

    try:
        await local_cache.delete_prefix("profiles:batch:")
        await publish_invalidate("profiles:batch:")
    except Exception:
        pass

    return updated


@router.delete("/dating/profile/{user_id}/photo")
async def remove_profile_photo(user_id: str, url: str):
    normalized_user_id = (user_id or "").strip()
    target_url = (url or "").strip()
    if not normalized_user_id or not target_url:
        raise HTTPException(status_code=400, detail="userId and url required")

    dating_db = get_dating_db()
    doc = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": normalized_user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")

    primary_existing: Optional[str] = None
    for key in ("primaryPhotoUrl", "photoUrl", "photo"):
        value = doc.get(key)
        if isinstance(value, str) and value.strip():
            primary_existing = value.strip()
            break

    photos: List[str] = []
    seen: Set[str] = set()
    raw_photos = doc.get("photos")
    if isinstance(raw_photos, list):
        for entry in raw_photos:
            if not isinstance(entry, str):
                continue
            trimmed = entry.strip()
            if not trimmed or trimmed == target_url:
                continue
            if trimmed in seen:
                continue
            seen.add(trimmed)
            photos.append(trimmed)

    next_primary = photos[0] if photos else None
    if primary_existing and primary_existing != target_url:
        next_primary = primary_existing

    placements_raw = doc.get("photoPlacements")
    normalized_placements: Optional[Dict[str, Any]] = None
    if isinstance(placements_raw, dict):
        normalized_placements = _normalize_photo_placements(placements_raw, photos)
        if normalized_placements and next_primary:
            normalized_placements.pop(next_primary, None)
        if normalized_placements == {}:
            normalized_placements = None

    now_ms = int(time.time() * 1000)
    set_payload: Dict[str, Any] = {
        "photos": photos,
        "updatedAt": now_ms,
        "userId": normalized_user_id,
    }
    unset_payload: Dict[str, int] = {}

    if next_primary:
        set_payload["primaryPhotoUrl"] = next_primary
    else:
        unset_payload["primaryPhotoUrl"] = 1

    if normalized_placements is not None:
        set_payload["photoPlacements"] = normalized_placements
    else:
        unset_payload["photoPlacements"] = 1

    update_spec: Dict[str, Any] = {"$set": set_payload}
    if unset_payload:
        update_spec["$unset"] = unset_payload

    await dating_db[DATING_PROFILES_COLLECTION].update_one(
        {"userId": normalized_user_id},
        update_spec,
    )

    updated = await dating_db[DATING_PROFILES_COLLECTION].find_one({"userId": normalized_user_id})
    updated = updated or {}
    updated.pop("_id", None)
    _apply_primary_photo_metadata(updated)
    _synchronize_name_fields(updated)
    updated.pop("hasDatingProfile", None)

    try:
        await local_cache.delete_prefix("profiles:batch:")
        await publish_invalidate("profiles:batch:")
    except Exception:
        pass

    return updated



