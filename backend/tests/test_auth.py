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


# --- token edge cases -------------------------------------------------------

def _forge(payload):
    payload = {"exp": datetime.now(timezone.utc) + timedelta(hours=1), **payload}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def test_me_rejects_token_without_sub(client):
    assert client.get("/api/auth/me", headers=auth_header(_forge({}))).status_code == 401


def test_me_rejects_non_numeric_sub(client):
    token = _forge({"sub": "abc"})
    assert client.get("/api/auth/me", headers=auth_header(token)).status_code == 401


def test_me_rejects_non_string_sub(client):
    token = _forge({"sub": [1]})
    assert client.get("/api/auth/me", headers=auth_header(token)).status_code == 401


def test_me_rejects_token_for_deleted_user(client):
    from app.models import User

    body = register(client).json()
    with client.session_factory() as db:
        db.delete(db.get(User, body["user"]["id"]))
        db.commit()
    assert client.get("/api/auth/me", headers=auth_header(body["token"])).status_code == 401


# --- bcrypt 72-byte limit ---------------------------------------------------

def test_password_of_exactly_72_bytes_accepted(client):
    assert register(client, password="a1" + "a" * 70).status_code == 201


def test_password_of_73_bytes_rejected(client):
    assert register(client, password="a1" + "a" * 71).status_code == 422


def test_multibyte_password_straddling_limit(client):
    # "e-acute" is 2 bytes: 2 + 35*2 = 72 bytes (ok); 2 + 36*2 = 74 bytes with
    # only 38 characters, so only a byte-based check can reject it.
    assert register(client, password="a1" + "é" * 35).status_code == 201
    assert register(client, email="b@example.com", password="a1" + "é" * 36).status_code == 422


# --- ASCII-only rules --------------------------------------------------------

def test_arabic_indic_digits_in_phone_rejected(client):
    assert register(client, phone="٠١٢٣٤٥٦٧٨٩").status_code == 422


def test_non_ascii_letters_and_digits_do_not_satisfy_password_policy(client):
    assert register(client, password="ééééééé١").status_code == 422


# --- duplicate-email race ----------------------------------------------------

def test_register_race_integrity_error_returns_409(client, monkeypatch):
    assert register(client).status_code == 201
    # Simulate the lookup missing the existing row (a concurrent sign-up):
    monkeypatch.setattr("app.routers.auth._get_by_email", lambda db, email: None)
    assert register(client).status_code == 409
