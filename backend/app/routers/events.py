from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy import String as SAString
from sqlalchemy import cast
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Event, User
from app.schemas import EventCreate, EventList, EventOut, EventSource, EventType
from app.security import get_current_user
from app.services.events import record_event

router = APIRouter(prefix="/events", tags=["events"])


def _day_start(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


@router.get("", response_model=EventList)
def list_events(
    type: EventType | None = None,
    source: EventSource | None = None,
    q: str | None = Query(None, max_length=200),
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventList:
    conditions = [Event.user_id == user.id]
    if type:
        conditions.append(Event.type == type)
    if source:
        conditions.append(Event.source == source)
    if q:
        needle = q.lower()
        conditions.append(
            func.lower(Event.title).contains(needle, autoescape=True)
            | func.lower(cast(Event.details, SAString)).contains(needle, autoescape=True)
        )
    if from_:
        conditions.append(Event.created_at >= _day_start(from_))
    if to:  # inclusive: everything before the start of the following day
        conditions.append(Event.created_at < _day_start(to + timedelta(days=1)))
    total = db.scalar(select(func.count()).select_from(Event).where(*conditions)) or 0
    rows = db.scalars(
        select(Event)
        .where(*conditions)
        .order_by(Event.created_at.desc(), Event.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return EventList(
        items=[EventOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{event_id}", response_model=EventOut)
def get_event(
    event_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Event:
    event = db.scalar(select(Event).where(Event.id == event_id, Event.user_id == user.id))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    return event


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Event:
    """Client-side events: camera sessions, navigation sessions, detections."""
    return record_event(
        db,
        user.id,
        payload.type,
        payload.title,
        source=payload.source,
        details=payload.details,
        status=payload.status,
        notify=payload.notify.model_dump() if payload.notify else None,
    )
