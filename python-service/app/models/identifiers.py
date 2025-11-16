"""Common identifier types shared across models."""

from __future__ import annotations

from typing import Annotated, Any

from bson import ObjectId
from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator


def _validate_object_id(value: Any) -> ObjectId:
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValueError("ObjectId string must not be empty")
        try:
            return ObjectId(text)
        except Exception as exc:  # pragma: no cover - invalid hex
            raise ValueError("Invalid ObjectId hex string") from exc
    raise TypeError("ObjectId value must be str or ObjectId instance")


PyObjectId = Annotated[
    ObjectId,
    BeforeValidator(_validate_object_id),
    PlainSerializer(lambda value: str(value), return_type=str),
]

__all__ = ["PyObjectId"]
