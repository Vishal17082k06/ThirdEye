"""Emergency SOS: email the guardian through Gmail SMTP.

Honesty rules: a SOS is 'sent' only after the SMTP server accepted the message;
any failure is stored as 'failed' with a safe reason (HTTP 200, the client shows it
and offers retry). GPS is included only when the client supplied it; SOS is NOT
restricted to the Coimbatore service area.

Idempotency: a second POST /api/sos within DOUBLE_TAP_WINDOW_S of the user's previous
one returns that existing record (200) instead of sending another email.

Retry: POST /{id}/retry claims the row with a conditional UPDATE (failed -> pending),
so two simultaneous retries cannot both send.
"""

import html
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Guardian, SosEvent, User, utcnow
from app.schemas import UtcDatetime
from app.security import get_current_user
from app.services.events import record_event
from app.services.mailer import Mailer, MailerError, clean_header, get_mailer

router = APIRouter(prefix="/sos", tags=["sos"])
logger = logging.getLogger(__name__)

DOUBLE_TAP_WINDOW_S = 10
STALE_PENDING_S = 120  # a 'pending' older than this is presumed stuck and may be retried
IST = ZoneInfo("Asia/Kolkata")
NO_GUARDIAN = "Add a guardian email in Profile before sending SOS."
NO_LOCATION = "Location: not available — GPS location could not be obtained."
FOOTER = "Sent by Third Eye. Please try to contact them immediately."
GENERIC_FAILURE = "Unexpected error while sending the email."
EMAIL_RE = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


class SosCreate(BaseModel):
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)] | None = None
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)] | None = None
    accuracy_m: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None = None
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None
    # Accepted for the client's convenience but never trusted: the server timestamp is used.
    client_time: datetime | None = None

    @model_validator(mode="after")
    def lat_lon_together(self) -> "SosCreate":
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon must be provided together")
        return self


class SosOut(BaseModel):
    id: int
    created_at: UtcDatetime
    status: str
    lat: float | None
    lon: float | None
    accuracy_m: float | None
    maps_link: str | None
    guardian_name: str | None
    guardian_email: str
    attempts: int
    error: str | None
    sent_at: UtcDatetime | None
    note: str | None
    delivery_message: str
    retry_available: bool


class SosList(BaseModel):
    items: list[SosOut]
    total: int
    limit: int
    offset: int


class SosStatus(BaseModel):
    email_configured: bool
    guardian_ready: bool
    guardian_name: str | None


def _is_stale_pending(row: SosEvent) -> bool:
    if row.status != "pending":
        return False
    started = row.attempted_at or row.created_at
    return _as_utc(started) < utcnow() - timedelta(seconds=STALE_PENDING_S)


def _delivery_message(row: SosEvent) -> str:
    if row.status == "sent":
        return (
            f"Email accepted by the mail server for delivery to {row.guardian_email}. "
            "This confirms the email was handed off, not that it was read."
        )
    if row.status == "failed":
        return row.error or GENERIC_FAILURE
    if _is_stale_pending(row):
        return "Still sending after more than 2 minutes — the email may not have gone out. You can retry."
    return "Sending…"


def to_out(row: SosEvent) -> SosOut:
    return SosOut(
        id=row.id,
        created_at=row.created_at,
        status=row.status,
        lat=row.lat,
        lon=row.lon,
        accuracy_m=row.accuracy_m,
        maps_link=row.maps_link,
        guardian_name=row.guardian_name,
        guardian_email=row.guardian_email,
        attempts=row.attempts,
        error=row.error,
        sent_at=row.sent_at,
        note=row.note,
        delivery_message=_delivery_message(row),
        retry_available=row.status == "failed" or _is_stale_pending(row),
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _fmt_time(value: datetime) -> str:
    utc = _as_utc(value)
    return f"{utc:%d %b %Y, %H:%M:%S} UTC / {utc.astimezone(IST):%d %b %Y, %H:%M:%S} IST"


def _number(value: float) -> str:
    return f"{value:g}"


def _location_line(row: SosEvent) -> str:
    if row.maps_link is None:
        return NO_LOCATION
    line = f"Location: {row.maps_link}"
    if row.accuracy_m is not None:
        line += f" (accuracy ±{_number(row.accuracy_m)} m)"
    return line


def _build_email(user: User, row: SosEvent) -> tuple[str, str, str]:
    """Return (subject, text, html). Wording never claims delivery or success."""
    subject = clean_header(f"EMERGENCY: {user.name} needs help (Third Eye SOS)")
    lines = [
        f"{user.name} has sent an emergency SOS from Third Eye and may need urgent help.",
        "",
        f"Name: {user.name}",
        f"Phone: {user.phone}",
        f"Time: {_fmt_time(row.created_at)}",
        _location_line(row),
    ]
    if row.note:
        lines.append(f"Note from {user.name}: {row.note}")
    if row.attempts > 1:
        lines += ["", f"Retry attempt {row.attempts} of the original alert sent at {_fmt_time(row.created_at)}."]
    lines += ["", FOOTER]
    text = "\n".join(lines)

    e = html.escape
    if row.maps_link is None:
        location_html = e(NO_LOCATION)
    else:
        location_html = f'Location: <a href="{e(row.maps_link)}">{e(row.maps_link)}</a>'
        if row.accuracy_m is not None:
            location_html += f" (accuracy ±{_number(row.accuracy_m)} m)"
    parts = [
        f"<p><strong>{e(user.name)}</strong> has sent an emergency SOS from Third Eye and may need urgent help.</p>",
        f"<p>Name: {e(user.name)}<br>Phone: {e(user.phone)}<br>Time: {e(_fmt_time(row.created_at))}<br>{location_html}</p>",
    ]
    if row.note:
        parts.append(f"<p>Note from {e(user.name)}: {e(row.note)}</p>")
    if row.attempts > 1:
        parts.append(
            f"<p>Retry attempt {row.attempts} of the original alert sent at {e(_fmt_time(row.created_at))}.</p>"
        )
    parts.append(f"<p>{e(FOOTER)}</p>")
    return subject, text, "\n".join(parts)


def _attempt_send(db: Session, user: User, row: SosEvent, mailer: Mailer) -> SosOut:
    """Send the email for `row` (already claimed, status 'pending') and record the outcome.

    Once the mail server has accepted the message nothing below may turn that into an
    error response: DB/notification problems are logged, never raised."""
    error: str | None = None
    try:
        subject, text, body_html = _build_email(user, row)
        mailer.send(row.guardian_email, subject, text, body_html)
    except MailerError as exc:
        error = str(exc)
    except Exception:  # never leak internals; delivery failure is still a 200 'failed'
        logger.exception("Unexpected error while sending SOS %s", row.id)
        error = GENERIC_FAILURE

    def apply() -> None:
        row.status = "failed" if error else "sent"
        row.error = error
        row.sent_at = None if error else utcnow()

    try:
        apply()
        out = to_out(row)  # built from memory so it survives a failing commit
    except Exception:
        logger.exception("Could not finalise SOS %s", row.id)
        raise
    for attempt in (1, 2):
        try:
            apply()
            db.commit()
            break
        except Exception:
            logger.exception("Could not store the outcome of SOS %s (attempt %s)", row.id, attempt)
            try:
                db.rollback()
            except Exception:
                logger.exception("Rollback failed for SOS %s", row.id)
    else:
        logger.critical(
            "SOS %s outcome %r could NOT be saved; returning it from memory only", row.id, out.status
        )
    name = row.guardian_name or row.guardian_email
    if error:
        notify = {"kind": "sos", "title": "SOS email FAILED — tap to retry", "body": error}
        title = f"SOS email to {name} failed"
    else:
        notify = {"kind": "sos", "title": f"SOS email sent to {name}", "body": out.delivery_message}
        title = f"SOS email sent to {name}"
    try:
        record_event(
            db,
            user.id,
            "sos",
            title,
            source="live",
            details={"sos_id": out.id, "attempt": out.attempts},
            status="failed" if error else "ok",
            notify=notify,
        )
    except Exception:
        logger.exception("Could not record the event/notification for SOS %s", out.id)
        try:
            db.rollback()
        except Exception:
            logger.exception("Rollback failed for SOS %s", out.id)
    return out


def _own(db: Session, user: User, sos_id: int) -> SosEvent:
    row = db.scalar(select(SosEvent).where(SosEvent.id == sos_id, SosEvent.user_id == user.id))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SOS not found")
    return row


def _guardian_with_email(db: Session, user: User) -> Guardian | None:
    guardian = db.scalar(select(Guardian).where(Guardian.user_id == user.id))
    if guardian is None or not EMAIL_RE.match(guardian.email.strip()):
        return None
    return guardian


@router.get("/status", response_model=SosStatus)
def sos_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SosStatus:
    guardian = _guardian_with_email(db, user)
    return SosStatus(
        email_configured=bool(settings.gmail_user.strip() and settings.gmail_app_password.strip()),
        guardian_ready=guardian is not None,
        guardian_name=guardian.name if guardian else None,
    )


# Plain `def` routes run in FastAPI's threadpool, so blocking SMTP never stalls the event loop.
@router.post("", response_model=SosOut)
def create_sos(
    payload: SosCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    mailer: Mailer = Depends(get_mailer),
) -> SosOut:
    guardian = _guardian_with_email(db, user)
    if guardian is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_GUARDIAN)
    recent = db.scalar(
        select(SosEvent)
        .where(
            SosEvent.user_id == user.id,
            # A recent FAILED record must not block a new attempt.
            SosEvent.status.in_(("sent", "pending")),
            func.coalesce(SosEvent.attempted_at, SosEvent.created_at)
            >= utcnow() - timedelta(seconds=DOUBLE_TAP_WINDOW_S),
        )
        .order_by(SosEvent.id.desc())
    )
    if recent is not None:
        return to_out(recent)
    has_location = payload.lat is not None and payload.lon is not None
    row = SosEvent(
        user_id=user.id,
        lat=payload.lat,
        lon=payload.lon,
        accuracy_m=payload.accuracy_m if has_location else None,
        maps_link=f"https://www.google.com/maps?q={payload.lat},{payload.lon}" if has_location else None,
        note=payload.note or None,
        status="pending",
        guardian_email=guardian.email.strip(),
        guardian_name=guardian.name,
        attempts=1,
        attempted_at=utcnow(),
    )
    db.add(row)
    db.commit()
    return _attempt_send(db, user, row, mailer)


@router.get("", response_model=SosList)
def list_sos(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SosList:
    total = db.scalar(select(func.count()).select_from(SosEvent).where(SosEvent.user_id == user.id)) or 0
    rows = db.scalars(
        select(SosEvent)
        .where(SosEvent.user_id == user.id)
        .order_by(SosEvent.created_at.desc(), SosEvent.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return SosList(items=[to_out(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/{sos_id}", response_model=SosOut)
def get_sos(sos_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SosOut:
    return to_out(_own(db, user, sos_id))


@router.post("/{sos_id}/retry", response_model=SosOut)
def retry_sos(
    sos_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    mailer: Mailer = Depends(get_mailer),
) -> SosOut:
    row = _own(db, user, sos_id)
    now = utcnow()
    stale_before = now - timedelta(seconds=STALE_PENDING_S)
    # Atomic claim: only a failed row, or a pending one whose last attempt started more
    # than STALE_PENDING_S ago. A concurrent retry sees a fresh attempted_at and matches 0 rows.
    claimed = db.execute(
        update(SosEvent)
        .where(
            SosEvent.id == sos_id,
            SosEvent.user_id == user.id,
            or_(
                SosEvent.status == "failed",
                and_(
                    SosEvent.status == "pending",
                    func.coalesce(SosEvent.attempted_at, SosEvent.created_at) < stale_before,
                ),
            ),
        )
        .values(status="pending", error=None, attempted_at=now, attempts=SosEvent.attempts + 1)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a failed or stuck SOS can be retried.")
    db.refresh(row)
    return _attempt_send(db, user, row, mailer)
