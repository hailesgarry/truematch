"""Custom exceptions for the repository layer."""

from __future__ import annotations


class RepositoryError(RuntimeError):
    """Base exception raised when a repository operation fails."""


class DuplicateKeyRepositoryError(RepositoryError):
    """Raised when attempting to insert a document that violates a unique index."""


class NotFoundRepositoryError(RepositoryError):
    """Raised when an expected document is missing."""


__all__ = [
    "DuplicateKeyRepositoryError",
    "NotFoundRepositoryError",
    "RepositoryError",
]
