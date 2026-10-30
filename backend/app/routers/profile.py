from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Guardian, User
from app.schemas import (
    ChangePasswordRequest,
    GuardianBody,
    MessageResponse,
    ProfileOut,
    ProfileUpdate,
)
from app.security import get_current_user, hash_password, verify_password

router = APIRouter(tags=["profile"])

EMAIL_TAKEN = "An account with this email already exists"


@router.get("/profile", response_model=ProfileOut)
def get_profile(user: User = Depends(get_current_user)) -> User:
    return user


@router.put("/profile", response_model=ProfileOut)
def update_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    changes = payload.model_dump(exclude_unset=True)
    # name/email/phone are NOT NULL columns, so an explicit null there means
    # "no change". Only age can be cleared by sending null.
    for field in ("name", "email", "phone"):
        if field in changes and changes[field] is None:
            del changes[field]
    new_email = changes.get("email")
    if new_email and new_email != user.email:
        if db.scalar(select(User).where(User.email == new_email)) is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN)
    for field, value in changes.items():
        setattr(user, field, value)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # lost a race with another account taking the email
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN) from None
    return user


@router.post("/profile/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "New password must differ from the current password"
        )
    user.password_hash = hash_password(payload.new_password)
    db.add(user)
    db.commit()
    return MessageResponse(message="Password updated")


_EMPTY_GUARDIAN = {"name": "", "email": "", "phone": "", "relationship": ""}


@router.get("/guardian")
def get_guardian(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict[str, str]:
    guardian = db.scalar(select(Guardian).where(Guardian.user_id == user.id))
    if guardian is None:
        return dict(_EMPTY_GUARDIAN)
    return {field: getattr(guardian, field) for field in _EMPTY_GUARDIAN}


@router.put("/guardian", response_model=GuardianBody)
def put_guardian(
    payload: GuardianBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Guardian:
    guardian = db.scalar(select(Guardian).where(Guardian.user_id == user.id))
    if guardian is None:
        guardian = Guardian(user_id=user.id)
    for field, value in payload.model_dump().items():
        setattr(guardian, field, value)
    db.add(guardian)
    db.commit()
    return guardian
