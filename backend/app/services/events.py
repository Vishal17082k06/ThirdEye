from typing import Any

from sqlalchemy.orm import Session

from app.models import Event, Notification
from app.schemas import EVENT_SOURCES, EVENT_TYPES


def record_event(
    db: Session,
    user_id: int,
    type: str,
    title: str,
    source: str = "live",
    details: dict[str, Any] | None = None,
    status: str = "ok",
    notify: dict[str, str] | None = None,
) -> Event:
    """Create an Event (and optionally a Notification with the same source).

    `notify` is None or {"kind", "title", "body"}. Both rows are written in one
    commit so an event never exists without its notification (or vice versa).
    """
    if type not in EVENT_TYPES:
        raise ValueError(f"Unknown event type: {type!r}")
    if source not in EVENT_SOURCES:
        raise ValueError(f"Unknown event source: {source!r}")
    event = Event(
        user_id=user_id,
        type=type,
        source=source,
        title=title,
        details=details or {},
        status=status,
    )
    db.add(event)
    if notify is not None:
        db.add(
            Notification(
                user_id=user_id,
                kind=notify["kind"],
                title=notify["title"],
                body=notify.get("body", ""),
                source=source,
            )
        )
    db.commit()
    return event
