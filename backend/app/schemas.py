import re
import string
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, get_args

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    PlainSerializer,
    field_validator,
)

from app.security import MAX_PASSWORD_BYTES


def _normalise_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


# Whitespace-trimmed, lowercased e-mail, validated for shape.
NormalisedEmail = Annotated[EmailStr, BeforeValidator(_normalise_email)]

_PHONE_RE = re.compile(r"^\+?[0-9]{7,15}$")


def _clean_phone(value: str) -> str:
    cleaned = re.sub(r"[\s-]", "", value)
    if not _PHONE_RE.match(cleaned):
        raise ValueError("Phone must have 7-15 digits, optionally starting with +")
    return cleaned


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name must not be blank")
    return value


def _check_password_policy(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        # bcrypt only reads the first 72 bytes; reject rather than silently truncate.
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes long")
    has_letter = any(c in string.ascii_letters for c in password)
    has_digit = any(c in string.digits for c in password)
    if not (has_letter and has_digit):
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
        return _clean_phone(value)

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


# ---------- profile / guardian ----------


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    phone: str
    age: int | None = None


class ProfileUpdate(BaseModel):
    """Every field optional: only the fields sent are changed."""

    name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    age: Annotated[int, Field(ge=1, le=120)] | None = None
    email: NormalisedEmail | None = None
    phone: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @field_validator("phone")
    @classmethod
    def phone_digits(cls, value: str | None) -> str | None:
        return None if value is None else _clean_phone(value)


class GuardianBody(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Annotated[str, Field(min_length=1, max_length=120)]
    email: NormalisedEmail
    phone: str
    relationship: Annotated[str, Field(min_length=1, max_length=60)]

    @field_validator("name", "relationship")
    @classmethod
    def not_blank(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("phone")
    @classmethod
    def phone_digits(cls, value: str) -> str:
        return _clean_phone(value)


class ChangePasswordRequest(BaseModel):
    current_password: Annotated[str, Field(max_length=1024)]
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_policy(cls, value: str) -> str:
        return _check_password_policy(value)


# ---------- settings document ----------


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CameraSettings(_Section):
    deviceId: str | None = None
    preferences: dict[str, Any] = {}


class HardwareSettings(_Section):
    deviceIp: Annotated[str, Field(max_length=200)] = ""
    pollingIntervalMs: Annotated[int, Field(ge=100, le=60000)] = 1000
    sensorSettings: dict[str, Any] = {}


class AiSettings(_Section):
    confidenceThreshold: Annotated[float, Field(ge=0.05, le=0.95)] = 0.5
    riskSettings: dict[str, Any] = {}
    openaiVisionEnabled: bool = False


class VoiceSettings(_Section):
    enabled: bool = True
    rate: Annotated[float, Field(ge=0.5, le=2)] = 1.0
    voiceName: str | None = None
    feedback: bool = True


class AccessibilitySettings(_Section):
    textSize: Literal["md", "lg", "xl"] = "md"
    highContrast: bool = False
    largeButtons: bool = False


class EmergencySettings(_Section):
    contact: Annotated[str, Field(max_length=200)] = ""


class SettingsDoc(_Section):
    camera: CameraSettings = CameraSettings()
    hardware: HardwareSettings = HardwareSettings()
    ai: AiSettings = AiSettings()
    voice: VoiceSettings = VoiceSettings()
    accessibility: AccessibilitySettings = AccessibilitySettings()
    emergency: EmergencySettings = EmergencySettings()


class EmailStatus(BaseModel):
    configured: bool


# ---------- time ----------


def to_utc_iso(value: datetime) -> str:
    """ISO 8601 UTC with a trailing Z. SQLite hands back naive datetimes (it drops
    the tzinfo on write), so naive values are treated as UTC before serialising."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


UtcDatetime = Annotated[datetime, PlainSerializer(to_utc_iso, return_type=str)]


# ---------- events / notifications ----------

EventType = Literal[
    "obstacle", "ai_analysis", "camera_session", "navigation",
    "ride", "sos", "device", "distance_reading",
]  # fmt: skip
EventSource = Literal["live", "simulation", "hardware"]
EVENT_TYPES: tuple[str, ...] = get_args(EventType)
EVENT_SOURCES: tuple[str, ...] = get_args(EventSource)


class NotifyIn(BaseModel):
    kind: Annotated[str, Field(min_length=1, max_length=40)]
    title: Annotated[str, Field(min_length=1, max_length=200)]
    body: Annotated[str, Field(max_length=2000)] = ""


class EventCreate(BaseModel):
    type: EventType
    source: EventSource = "live"
    title: Annotated[str, Field(min_length=1, max_length=200)]
    details: dict[str, Any] = {}
    status: Annotated[str, Field(min_length=1, max_length=30)] = "ok"
    notify: NotifyIn | None = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    source: str
    title: str
    details: dict[str, Any]
    status: str
    created_at: UtcDatetime


class EventList(BaseModel):
    items: list[EventOut]
    total: int
    limit: int
    offset: int


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    body: str
    source: str
    read: bool
    created_at: UtcDatetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread_count: int
