from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Notification, User
from app.schemas import NotificationList, NotificationOut
from app.security import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList)
def list_notifications(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> NotificationList:
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    ).all()
    unread = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read.is_(False))
    )
    return NotificationList(
        items=[NotificationOut.model_validate(r) for r in rows], unread_count=unread or 0
    )


# Declared before /{id}/read so "read-all" is never parsed as an id.
@router.post("/read-all")
def read_all(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict[str, int]:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read.is_(False))
        .values(read=True)
    )
    db.commit()
    return {"updated": result.rowcount}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Notification:
    note = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    note.read = True
    db.commit()
    return note


@router.delete("")
def clear_all(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict[str, int]:
    result = db.execute(delete(Notification).where(Notification.user_id == user.id))
    db.commit()
    return {"deleted": result.rowcount}
