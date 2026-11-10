"""Read-only FastAPI application for the generated cell-culture data lake."""

from .app import create_app

__all__ = ["create_app"]
