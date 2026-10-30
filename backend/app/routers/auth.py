from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.schemas import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    UserOut,
)
from app.security import create_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_CREDENTIALS = "Invalid email or password"
# Verified against when the email is unknown so both failure paths cost a bcrypt
# check, which stops response time from revealing whether an account exists.
_DUMMY_HASH = hash_password("dummy-password-1")


def _get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    conflict = HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    if _get_by_email(db, payload.email) is not None:
        raise conflict
    user = User(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # two simultaneous sign-ups with the same email
        db.rollback()
        raise conflict from None
    return AuthResponse(token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = _get_by_email(db, payload.email)
    password_ok = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not password_ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)
    return AuthResponse(
        token=create_token(user.id, remember=payload.remember),
        user=UserOut.model_validate(user),
    )


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def forgot_password(payload: ForgotPasswordRequest) -> MessageResponse:
    # Sending the reset email is deferred until the mailer service exists. The
    # response is deliberately identical whether or not the account exists, so
    # this endpoint cannot be used to discover which emails are registered.
    return MessageResponse(
        message="If an account exists for that email, password reset instructions will be sent."
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
