from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import settings

VALID = {
    "name": "Asha Rao",
    "email": "asha@example.com",
    "phone": "+91 98765-43210",
    "password": "Secret123",
}


def register(client, **overrides):
    return client.post("/api/auth/register", json={**VALID, **overrides})


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def token_lifetime(token):
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    return datetime.fromtimestamp(payload["exp"], tz=timezone.utc) - datetime.now(timezone.utc)


def test_register_ok(client):
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["token"]
    assert body["user"] == {
        "id": body["user"]["id"],
        "name": "Asha Rao",
        "email": "asha@example.com",
        "phone": "+919876543210",
    }
    assert "password" not in str(body) and "password_hash" not in str(body)


def test_register_normalises_email(client):
    r = register(client, email="  Asha@Example.COM ")
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "asha@example.com"


def test_register_duplicate_email_409(client):
    assert register(client).status_code == 201
    r = register(client, email="ASHA@example.com")
    assert r.status_code == 409


@pytest.mark.parametrize(
    "password",
    ["short1", "alllettersonly", "1234567890", "a" * 73 + "1"],
)
def test_register_weak_password_422(client, password):
    assert register(client, password=password).status_code == 422


@pytest.mark.parametrize("phone", ["12345", "abcdefghij", "+1234567890123456", "98765x3210"])
def test_register_invalid_phone_422(client, phone):
    assert register(client, phone=phone).status_code == 422


def test_register_invalid_email_422(client):
    assert register(client, email="not-an-email").status_code == 422


def test_login_ok(client):
    register(client)
    r = client.post("/api/auth/login", json={"email": "Asha@example.com", "password": "Secret123"})
    assert r.status_code == 200
    assert r.json()["token"]
    assert r.json()["user"]["email"] == "asha@example.com"


def test_login_wrong_password_and_unknown_email_same_401(client):
    register(client)
    bad_pw = client.post("/api/auth/login", json={"email": VALID["email"], "password": "Wrong1234"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "Wrong1234"})
    assert bad_pw.status_code == unknown.status_code == 401
    assert bad_pw.json() == unknown.json()


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=auth_header("garbage")).status_code == 401


def test_me_returns_user_with_valid_token(client):
    token = register(client).json()["token"]
    r = client.get("/api/auth/me", headers=auth_header(token))
    assert r.status_code == 200
    assert r.json()["email"] == "asha@example.com"
    assert "password_hash" not in r.json()


def test_forgot_password_same_202_for_existing_and_unknown(client):
    register(client)
    known = client.post("/api/auth/forgot-password", json={"email": VALID["email"]})
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()


def test_remember_flag_gives_longer_expiry(client):
    register(client)
    creds = {"email": VALID["email"], "password": VALID["password"]}
    short = client.post("/api/auth/login", json=creds).json()["token"]
    long = client.post("/api/auth/login", json={**creds, "remember": True}).json()["token"]
    assert token_lifetime(short) <= timedelta(days=1, minutes=1)
    assert token_lifetime(long) > timedelta(days=29)
