import pytest

from app.config import settings

from tests.test_auth import VALID, auth_header, register


def signup(client, **overrides):
    r = register(client, **overrides)
    assert r.status_code == 201
    return auth_header(r.json()["token"])


@pytest.fixture()
def headers(client):
    return signup(client)


# ---------- profile ----------


def test_profile_requires_auth(client):
    assert client.get("/api/profile").status_code == 401
    assert client.put("/api/profile", json={}).status_code == 401


def test_get_profile(client, headers):
    r = client.get("/api/profile", headers=headers)
    assert r.status_code == 200
    assert r.json() == {
        "id": r.json()["id"],
        "name": "Asha Rao",
        "email": "asha@example.com",
        "phone": "+919876543210",
        "age": None,
    }


def test_update_profile(client, headers):
    r = client.put(
        "/api/profile",
        headers=headers,
        json={"name": "Asha R", "age": 30, "phone": "98765 43211"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Asha R"
    assert r.json()["age"] == 30
    assert r.json()["phone"] == "9876543211"
    assert client.get("/api/profile", headers=headers).json()["age"] == 30


def test_update_profile_partial_keeps_other_fields(client, headers):
    client.put("/api/profile", headers=headers, json={"age": 40})
    r = client.put("/api/profile", headers=headers, json={"name": "New Name"})
    assert r.json()["age"] == 40
    assert r.json()["name"] == "New Name"


def test_update_profile_age_can_be_cleared(client, headers):
    client.put("/api/profile", headers=headers, json={"age": 40})
    r = client.put("/api/profile", headers=headers, json={"age": None})
    assert r.json()["age"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"age": 0},
        {"age": 121},
        {"phone": "12345"},
        {"phone": "١٢٣٤٥٦٧٨٩"},  # non-ASCII digits
        {"name": "   "},
        {"email": "not-an-email"},
    ],
)
def test_update_profile_validation_422(client, headers, body):
    assert client.put("/api/profile", headers=headers, json=body).status_code == 422


def test_update_profile_email_unique(client, headers):
    signup(client, email="other@example.com")
    r = client.put("/api/profile", headers=headers, json={"email": "Other@Example.com"})
    assert r.status_code == 409


def test_update_profile_same_email_ok(client, headers):
    r = client.put("/api/profile", headers=headers, json={"email": "ASHA@example.com"})
    assert r.status_code == 200


def test_update_profile_new_email(client, headers):
    r = client.put("/api/profile", headers=headers, json={"email": "new@example.com"})
    assert r.status_code == 200
    assert r.json()["email"] == "new@example.com"


# ---------- guardian ----------

GUARDIAN = {
    "name": "Ravi Rao",
    "email": "Ravi@Example.com",
    "phone": "+91 99999 11111",
    "relationship": "Brother",
}


def test_guardian_empty_when_unset(client, headers):
    r = client.get("/api/guardian", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"name": "", "email": "", "phone": "", "relationship": ""}


def test_guardian_put_and_get(client, headers):
    r = client.put("/api/guardian", headers=headers, json=GUARDIAN)
    assert r.status_code == 200
    expected = {
        "name": "Ravi Rao",
        "email": "ravi@example.com",
        "phone": "+919999911111",
        "relationship": "Brother",
    }
    assert r.json() == expected
    assert client.get("/api/guardian", headers=headers).json() == expected


def test_guardian_put_updates_existing(client, headers):
    client.put("/api/guardian", headers=headers, json=GUARDIAN)
    r = client.put("/api/guardian", headers=headers, json={**GUARDIAN, "name": "Other"})
    assert r.json()["name"] == "Other"


@pytest.mark.parametrize(
    "override",
    [{"email": "bad"}, {"phone": "123"}, {"name": ""}, {"relationship": ""}],
)
def test_guardian_validation_422(client, headers, override):
    r = client.put("/api/guardian", headers=headers, json={**GUARDIAN, **override})
    assert r.status_code == 422


def test_guardian_is_per_user(client, headers):
    client.put("/api/guardian", headers=headers, json=GUARDIAN)
    other = signup(client, email="b@example.com")
    assert client.get("/api/guardian", headers=other).json()["name"] == ""


# ---------- change password ----------


def test_change_password_ok(client, headers):
    r = client.post(
        "/api/profile/change-password",
        headers=headers,
        json={"current_password": "Secret123", "new_password": "Newpass456"},
    )
    assert r.status_code == 200
    old = client.post("/api/auth/login", json={"email": VALID["email"], "password": "Secret123"})
    new = client.post("/api/auth/login", json={"email": VALID["email"], "password": "Newpass456"})
    assert old.status_code == 401
    assert new.status_code == 200


def test_change_password_wrong_current(client, headers):
    r = client.post(
        "/api/profile/change-password",
        headers=headers,
        json={"current_password": "Wrong12345", "new_password": "Newpass456"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Current password is incorrect"


def test_change_password_must_differ(client, headers):
    r = client.post(
        "/api/profile/change-password",
        headers=headers,
        json={"current_password": "Secret123", "new_password": "Secret123"},
    )
    assert r.status_code == 400


def test_change_password_policy_422(client, headers):
    r = client.post(
        "/api/profile/change-password",
        headers=headers,
        json={"current_password": "Secret123", "new_password": "short1"},
    )
    assert r.status_code == 422


def test_change_password_requires_auth(client):
    r = client.post(
        "/api/profile/change-password",
        json={"current_password": "a", "new_password": "Newpass456"},
    )
    assert r.status_code == 401


# ---------- settings ----------

DEFAULTS = {
    "camera": {"deviceId": None, "preferences": {}},
    "hardware": {"deviceIp": "", "pollingIntervalMs": 1000, "sensorSettings": {}},
    "ai": {"confidenceThreshold": 0.5, "riskSettings": {}, "openaiVisionEnabled": False},
    "voice": {"enabled": True, "rate": 1.0, "voiceName": None, "feedback": True},
    "accessibility": {"textSize": "md", "highContrast": False, "largeButtons": False},
    "emergency": {"contact": ""},
}


def test_settings_defaults(client, headers):
    r = client.get("/api/settings", headers=headers)
    assert r.status_code == 200
    assert r.json() == DEFAULTS


def test_settings_requires_auth(client):
    assert client.get("/api/settings").status_code == 401
    assert client.put("/api/settings", json={}).status_code == 401


def test_settings_partial_update_merges(client, headers):
    r = client.put(
        "/api/settings",
        headers=headers,
        json={"voice": {"rate": 1.5}, "accessibility": {"textSize": "xl"}},
    )
    assert r.status_code == 200
    r = client.put("/api/settings", headers=headers, json={"voice": {"enabled": False}})
    body = r.json()
    assert body["voice"] == {"enabled": False, "rate": 1.5, "voiceName": None, "feedback": True}
    assert body["accessibility"]["textSize"] == "xl"
    assert body["ai"] == DEFAULTS["ai"]
    assert client.get("/api/settings", headers=headers).json() == body


def test_settings_free_form_fields(client, headers):
    r = client.put(
        "/api/settings",
        headers=headers,
        json={"hardware": {"deviceIp": "192.168.1.5", "sensorSettings": {"offset": 3}}},
    )
    assert r.json()["hardware"]["deviceIp"] == "192.168.1.5"
    assert r.json()["hardware"]["sensorSettings"] == {"offset": 3}


@pytest.mark.parametrize(
    "body",
    [
        {"ai": {"confidenceThreshold": 0.04}},
        {"ai": {"confidenceThreshold": 0.96}},
        {"voice": {"rate": 0.4}},
        {"voice": {"rate": 2.1}},
        {"accessibility": {"textSize": "huge"}},
        {"voice": {"bogus": 1}},
        {"bogusSection": {"a": 1}},
        {"voice": "loud"},
        {"hardware": {"pollingIntervalMs": 0}},
    ],
)
def test_settings_validation_422(client, headers, body):
    r = client.put("/api/settings", headers=headers, json=body)
    assert r.status_code == 422
    # a rejected update must not be stored
    assert client.get("/api/settings", headers=headers).json() == DEFAULTS


def test_settings_per_user(client, headers):
    client.put("/api/settings", headers=headers, json={"voice": {"enabled": False}})
    other = signup(client, email="b@example.com")
    assert client.get("/api/settings", headers=other).json()["voice"]["enabled"] is True


def test_email_status(client, headers, monkeypatch):
    monkeypatch.setattr(settings, "gmail_user", "")
    monkeypatch.setattr(settings, "gmail_app_password", "")
    assert client.get("/api/settings/email-status", headers=headers).json() == {
        "configured": False
    }
    monkeypatch.setattr(settings, "gmail_user", "me@gmail.com")
    assert client.get("/api/settings/email-status", headers=headers).json() == {
        "configured": False
    }
    monkeypatch.setattr(settings, "gmail_app_password", "secretsecret")
    r = client.get("/api/settings/email-status", headers=headers)
    assert r.json() == {"configured": True}
    assert "secretsecret" not in r.text and "me@gmail.com" not in r.text
