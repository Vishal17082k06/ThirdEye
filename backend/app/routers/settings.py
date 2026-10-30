from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings as app_settings
from app.db import get_db
from app.models import User, UserSettings
from app.schemas import EmailStatus, SettingsDoc
from app.security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


def _row(db: Session, user: User) -> UserSettings | None:
    return db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))


def _load(db: Session, user: User) -> dict[str, Any]:
    row = _row(db, user)
    return dict(row.data) if row is not None else {}


@router.get("", response_model=SettingsDoc)
def get_settings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> SettingsDoc:
    return SettingsDoc.model_validate(_load(db, user))


@router.put("", response_model=SettingsDoc)
def put_settings(
    patch: dict[str, Any] = Body(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SettingsDoc:
    """Merge the sent sections (field by field) into the stored document."""
    merged = _load(db, user)
    for section, values in patch.items():
        current = merged.get(section)
        if isinstance(values, dict) and (current is None or isinstance(current, dict)):
            merged[section] = {**(current or {}), **values}
        else:
            merged[section] = values  # wrong shape: rejected by validation below
    try:
        doc = SettingsDoc.model_validate(merged)
    except ValidationError as exc:
        raise RequestValidationError(
            exc.errors(include_url=False, include_context=False, include_input=False)
        ) from None
    row = _row(db, user)
    if row is None:
        row = UserSettings(user_id=user.id)
    row.data = doc.model_dump()
    db.add(row)
    db.commit()
    return doc


@router.get("/email-status", response_model=EmailStatus)
def email_status(_: User = Depends(get_current_user)) -> EmailStatus:
    configured = bool(app_settings.gmail_user and app_settings.gmail_app_password)
    return EmailStatus(configured=configured)
