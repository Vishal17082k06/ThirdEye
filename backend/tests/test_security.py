from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import settings
from app.security import (
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_differs_from_plain():
    assert hash_password("Secret123") != "Secret123"


def test_hash_is_salted():
    assert hash_password("Secret123") != hash_password("Secret123")


def test_verify_password_true_and_false():
    hashed = hash_password("Secret123")
    assert verify_password("Secret123", hashed) is True
    assert verify_password("Wrong1234", hashed) is False


def test_verify_password_rejects_malformed_hash():
    assert verify_password("Secret123", "not-a-bcrypt-hash") is False


def test_token_roundtrip():
    assert decode_token(create_token(42, remember=False)) == 42


def _exp(token: str) -> datetime:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    return datetime.fromtimestamp(payload["exp"], tz=timezone.utc)


def test_remember_extends_expiry():
    now = datetime.now(timezone.utc)
    short = _exp(create_token(1, remember=False))
    long = _exp(create_token(1, remember=True))
    assert timedelta(hours=23) < short - now <= timedelta(days=1, minutes=1)
    assert timedelta(days=29) < long - now <= timedelta(days=30, minutes=1)


def test_expired_token_rejected():
    expired = jwt.encode(
        {"sub": "1", "exp": datetime.now(timezone.utc) - timedelta(seconds=5)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(ValueError):
        decode_token(expired)


def test_tampered_token_rejected():
    forged = jwt.encode({"sub": "1"}, "another-secret-key-of-enough-length-1234", algorithm="HS256")
    with pytest.raises(ValueError):
        decode_token(forged)
