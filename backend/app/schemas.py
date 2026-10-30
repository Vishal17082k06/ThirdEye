import re
from typing import Annotated

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)

from app.security import MAX_PASSWORD_BYTES


def _normalise_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


# Whitespace-trimmed, lowercased e-mail, validated for shape.
NormalisedEmail = Annotated[EmailStr, BeforeValidator(_normalise_email)]

_PHONE_RE = re.compile(r"^\+?\d{7,15}$")


def _check_password_policy(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        # bcrypt only reads the first 72 bytes; reject rather than silently truncate.
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes long")
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        raise ValueError("Password must contain at least one letter and one digit")
    return password


class RegisterRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    email: NormalisedEmail
    phone: str
    password: str

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name must not be blank")
        return value

    @field_validator("phone")
    @classmethod
    def phone_digits(cls, value: str) -> str:
        cleaned = re.sub(r"[\s-]", "", value)
        if not _PHONE_RE.match(cleaned):
            raise ValueError("Phone must have 7-15 digits, optionally starting with +")
        return cleaned

    @field_validator("password")
    @classmethod
    def password_policy(cls, value: str) -> str:
        return _check_password_policy(value)


class LoginRequest(BaseModel):
    email: NormalisedEmail
    # No policy check here: login must not reveal the policy or reject old passwords.
    password: Annotated[str, Field(max_length=1024)]
    remember: bool = False


class ForgotPasswordRequest(BaseModel):
    email: NormalisedEmail


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    phone: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class MessageResponse(BaseModel):
    message: str
