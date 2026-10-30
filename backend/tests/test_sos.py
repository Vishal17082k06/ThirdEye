import json
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, inspect, text

from app.config import settings
from app.db import add_missing_columns
from app.main import app
from app.models import Event, Notification, SosEvent
from app.services.mailer import MailerError, MailerNotConfigured, get_mailer
from tests.test_auth import auth_header, register

GUARDIAN = {"name": "Meena", "email": "meena@example.com", "phone": "+919876543211", "relationship": "Mother"}
NOT_AVAILABLE = "Location: not available — GPS location could not be obtained."
FOOTER = "Sent by Third Eye. Please try to contact them immediately."
JSON_HEADERS = {"Content-Type": "application/json"}


class FakeMailer:
    def __init__(self):
        self.sent = []
        self.error = None

    def send(self, to, subject, body_text, body_html=None):
        if self.error:
            raise self.error
        self.sent.append({"to": to, "subject": subject, "text": body_text, "html": body_html})


@pytest.fixture()
def mailer():
    fake = FakeMailer()
    app.dependency_overrides[get_mailer] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_mailer, None)


@pytest.fixture()
def h(client, mailer):
    token = register(client, name="Asha Rao", email="asha@example.com").json()["token"]
    headers = auth_header(token)
    assert client.put("/api/guardian", json=GUARDIAN, headers=headers).status_code == 200
    return headers


def sos(client, h, **body):
    return client.post("/api/sos", json=body, headers=h)


def backdate(client, sos_id, seconds=60):
    with client.session_factory() as db:
        row = db.get(SosEvent, sos_id)
        row.created_at = row.created_at - timedelta(seconds=seconds)
        db.commit()


def notifications(client):
    with client.session_factory() as db:
        return [(n.kind, n.title, n.body) for n in db.query(Notification).order_by(Notification.id)]


def test_auth_required(client):
    assert client.post("/api/sos", json={}).status_code == 401
    assert client.get("/api/sos").status_code == 401
    assert client.get("/api/sos/status").status_code == 401


def test_success_sent_shape_and_email(client, h, mailer):
    r = sos(client, h, lat=11.0168, lon=76.9558, accuracy_m=12.5, note="Fell down")
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {
        "id", "created_at", "status", "lat", "lon", "accuracy_m", "maps_link", "guardian_name",
        "guardian_email", "attempts", "error", "sent_at", "note", "delivery_message",
    }
    assert d["status"] == "sent" and d["attempts"] == 1 and d["error"] is None
    assert d["created_at"].endswith("Z") and d["sent_at"].endswith("Z")
    assert d["maps_link"] == "https://www.google.com/maps?q=11.0168,76.9558"
    assert d["guardian_name"] == "Meena" and d["guardian_email"] == "meena@example.com"
    assert d["note"] == "Fell down" and d["accuracy_m"] == 12.5
    assert d["delivery_message"] == (
        "Email accepted by the mail server for delivery to meena@example.com. "
        "This confirms the email was handed off, not that it was read."
    )
    (mail,) = mailer.sent
    assert mail["to"] == "meena@example.com"
    assert mail["subject"] == "EMERGENCY: Asha Rao needs help (Third Eye SOS)"
    for part in (mail["text"], mail["html"]):
        assert "Asha Rao" in part and "+919876543210" in part and "Fell down" in part
        assert "UTC" in part and "IST" in part
        assert "https://www.google.com/maps?q=11.0168,76.9558" in part
        assert "±12.5 m" in part
        assert FOOTER in part
    assert "Location: https://www.google.com/maps?q=11.0168,76.9558 (accuracy ±12.5 m)" in mail["text"]


def test_email_body_makes_no_delivery_claims(client, h, mailer):
    sos(client, h)
    body = (mailer.sent[0]["text"] + mailer.sent[0]["html"]).lower()
    assert "sent successfully" not in body and "delivered" not in body


def test_notification_and_event_on_acceptance(client, h, mailer):
    sos(client, h)
    notes = notifications(client)
    assert [n[:2] for n in notes] == [("sos", "SOS email sent to Meena")]
    with client.session_factory() as db:
        ev = db.query(Event).filter_by(type="sos").one()
        assert (ev.source, ev.status) == ("live", "ok")


def test_mailer_failure_is_failed_not_5xx(client, h, mailer):
    mailer.error = MailerError("Mail server rejected the login.")
    r = sos(client, h)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "failed" and d["sent_at"] is None and d["attempts"] == 1
    assert d["error"] == "Mail server rejected the login."
    assert d["delivery_message"] == "Mail server rejected the login."
    notes = notifications(client)
    assert [n[:2] for n in notes] == [("sos", "SOS email FAILED — tap to retry")]
    with client.session_factory() as db:
        assert db.query(Event).filter_by(type="sos").one().status == "failed"


def test_not_configured_is_failed(client, h, mailer):
    mailer.error = MailerNotConfigured()
    d = sos(client, h).json()
    assert d["status"] == "failed"
    assert d["delivery_message"] == "Email service is not configured on the server."


def test_unexpected_exception_is_failed_with_generic_message(client, h, mailer):
    mailer.error = RuntimeError("secret internals")
    d = sos(client, h).json()
    assert d["status"] == "failed" and "secret" not in str(d)


def test_no_guardian_400_and_no_row(client, mailer):
    headers = auth_header(register(client, email="lonely@example.com").json()["token"])
    r = sos(client, headers)
    assert r.status_code == 400
    assert r.json() == {"detail": "Add a guardian email in Profile before sending SOS."}
    assert mailer.sent == []
    with client.session_factory() as db:
        assert db.query(SosEvent).count() == 0


def test_guardian_without_valid_email_400(client, mailer):
    headers = auth_header(register(client, email="x@example.com").json()["token"])
    client.put("/api/guardian", json={**GUARDIAN, "email": "not-an-email"}, headers=headers)
    assert sos(client, headers).status_code == 400
    assert mailer.sent == []


def test_no_coordinates_exact_line_and_no_link(client, h, mailer):
    d = sos(client, h).json()
    assert d["maps_link"] is None and d["lat"] is None and d["lon"] is None
    assert NOT_AVAILABLE in mailer.sent[0]["text"]
    assert NOT_AVAILABLE in mailer.sent[0]["html"]
    assert "google.com/maps" not in mailer.sent[0]["text"] + mailer.sent[0]["html"]


def test_coordinates_without_accuracy(client, h, mailer):
    sos(client, h, lat=1.5, lon=2.5)
    assert "Location: https://www.google.com/maps?q=1.5,2.5\n" in mailer.sent[0]["text"]


@pytest.mark.parametrize(
    "body",
    [
        {"lat": 11.0},
        {"lon": 76.9},
        {"lat": 91, "lon": 0},
        {"lat": 0, "lon": 181},
        {"lat": -91, "lon": 0},
        {"lat": 0, "lon": 0, "accuracy_m": -1},
        {"note": "x" * 301},
        {"client_time": "not a date"},
    ],
)
def test_validation_422(client, h, mailer, body):
    r = client.post("/api/sos", content=json.dumps(body), headers={**h, **JSON_HEADERS})
    assert r.status_code == 422
    assert mailer.sent == []


@pytest.mark.parametrize("raw", ['{"lat": NaN, "lon": 1}', '{"lat": 1, "lon": Infinity}', '{"lat":1,"lon":1,"accuracy_m":NaN}'])
def test_nan_inf_422(client, h, mailer, raw):
    r = client.post("/api/sos", content=raw, headers={**h, **JSON_HEADERS})
    assert r.status_code == 422
    assert mailer.sent == []


def test_outside_service_area_allowed(client, h, mailer):
    d = sos(client, h, lat=51.5074, lon=-0.1278).json()  # London
    assert d["status"] == "sent"
    assert d["maps_link"] == "https://www.google.com/maps?q=51.5074,-0.1278"


def test_subject_header_injection_stripped(client, mailer):
    token = register(client, name="Evil\r\nBcc: x@evil.com", email="evil@example.com").json()["token"]
    headers = auth_header(token)
    client.put("/api/guardian", json=GUARDIAN, headers=headers)
    sos(client, headers)
    subject = mailer.sent[0]["subject"]
    assert "\r" not in subject and "\n" not in subject
    assert "needs help" in subject


def test_html_body_escapes_user_text(client, h, mailer):
    sos(client, h, note="<script>alert(1)</script>")
    assert "<script>" not in mailer.sent[0]["html"]
    assert "<script>" in mailer.sent[0]["text"]


def test_double_tap_returns_existing_record(client, h, mailer):
    first = sos(client, h).json()
    second = sos(client, h, note="again")
    assert second.status_code == 200 and second.json()["id"] == first["id"]
    assert len(mailer.sent) == 1
    backdate(client, first["id"], 11)
    third = sos(client, h).json()
    assert third["id"] != first["id"] and len(mailer.sent) == 2


def test_history_newest_first_scoped_paged(client, h, mailer):
    ids = []
    for _ in range(3):
        ids.append(sos(client, h).json()["id"])
        backdate(client, ids[-1], 60)
    other = auth_header(register(client, email="other@example.com").json()["token"])
    client.put("/api/guardian", json=GUARDIAN, headers=other)
    sos(client, other)
    r = client.get("/api/sos", headers=h).json()
    assert [i["id"] for i in r["items"]] == ids[::-1]
    assert r["total"] == 3 and r["limit"] == 50 and r["offset"] == 0
    page = client.get("/api/sos?limit=1&offset=1", headers=h).json()
    assert [i["id"] for i in page["items"]] == [ids[1]] and page["total"] == 3


def test_get_one_and_cross_user_404(client, h, mailer):
    sid = sos(client, h).json()["id"]
    assert client.get(f"/api/sos/{sid}", headers=h).json()["id"] == sid
    other = auth_header(register(client, email="other@example.com").json()["token"])
    assert client.get(f"/api/sos/{sid}", headers=other).status_code == 404
    assert client.post(f"/api/sos/{sid}/retry", headers=other).status_code == 404
    assert client.get("/api/sos/9999", headers=h).status_code == 404


def test_retry_only_when_failed(client, h, mailer):
    sid = sos(client, h).json()["id"]
    assert client.post(f"/api/sos/{sid}/retry", headers=h).status_code == 409
    assert len(mailer.sent) == 1


def test_retry_keeps_original_time_and_location(client, h, mailer):
    mailer.error = MailerError("Could not connect to the mail server.")
    first = sos(client, h, lat=11.0, lon=77.0, accuracy_m=5, note="help").json()
    notes_before = len(notifications(client))
    mailer.error = None
    r = client.post(f"/api/sos/{first['id']}/retry", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "sent" and d["attempts"] == 2 and d["error"] is None and d["sent_at"]
    assert d["created_at"] == first["created_at"]
    assert (d["lat"], d["lon"], d["maps_link"], d["note"]) == (11.0, 77.0, first["maps_link"], "help")
    (mail,) = mailer.sent
    assert "Retry attempt 2 of the original alert sent at" in mail["text"]
    assert "https://www.google.com/maps?q=11.0,77.0" in mail["text"]
    notes = notifications(client)
    assert len(notes) == notes_before + 1 and notes[-1][1] == "SOS email sent to Meena"


def test_retry_can_fail_again(client, h, mailer):
    mailer.error = MailerError("Mail server rejected the login.")
    sid = sos(client, h).json()["id"]
    d = client.post(f"/api/sos/{sid}/retry", headers=h).json()
    assert d["status"] == "failed" and d["attempts"] == 2
    assert client.post(f"/api/sos/{sid}/retry", headers=h).json()["attempts"] == 3


def test_retry_race_sends_once(client, h, mailer):
    mailer.error = MailerError("x")
    sid = sos(client, h).json()["id"]
    mailer.error = None
    with client.session_factory() as db:  # another retry already claimed it (status flipped to pending)
        db.get(SosEvent, sid).status = "pending"
        db.commit()
    assert client.post(f"/api/sos/{sid}/retry", headers=h).status_code == 409
    assert mailer.sent == []


def test_retry_claims_row_before_sending(client, h, mailer):
    """The row is flipped failed -> pending (committed) BEFORE the slow SMTP call, so a
    concurrent retry's conditional UPDATE matches nothing and gets 409 (see race test above)."""
    mailer.error = MailerError("x")
    sid = sos(client, h).json()["id"]
    mailer.error = None
    seen = []
    original_send = mailer.send

    def spy(*args, **kwargs):
        with client.session_factory() as db:
            row = db.get(SosEvent, sid)
            seen.append((row.status, row.attempts))
        original_send(*args, **kwargs)

    mailer.send = spy
    assert client.post(f"/api/sos/{sid}/retry", headers=h).status_code == 200
    assert seen == [("pending", 2)]


def test_status_endpoint(client, h, monkeypatch):
    monkeypatch.setattr(settings, "gmail_user", "")
    monkeypatch.setattr(settings, "gmail_app_password", "")
    assert client.get("/api/sos/status", headers=h).json() == {
        "email_configured": False, "guardian_ready": True, "guardian_name": "Meena",
    }
    monkeypatch.setattr(settings, "gmail_user", "me@gmail.com")
    monkeypatch.setattr(settings, "gmail_app_password", "secret-pw")
    r = client.get("/api/sos/status", headers=h)
    assert r.json()["email_configured"] is True
    assert "secret-pw" not in r.text and "me@gmail.com" not in r.text
    bare = auth_header(register(client, email="bare@example.com").json()["token"])
    assert client.get("/api/sos/status", headers=bare).json() == {
        "email_configured": True, "guardian_ready": False, "guardian_name": None,
    }


def test_add_missing_columns_upgrades_old_table():
    eng = create_engine("sqlite://")
    with eng.begin() as conn:
        conn.execute(text(
            "CREATE TABLE sos_events (id INTEGER PRIMARY KEY, user_id INTEGER, created_at DATETIME, "
            "lat FLOAT, lon FLOAT, maps_link VARCHAR(300), status VARCHAR(30), error TEXT, "
            "guardian_email VARCHAR(254), attempts INTEGER)"
        ))
    add_missing_columns(eng)
    add_missing_columns(eng)  # idempotent
    cols = {c["name"] for c in inspect(eng).get_columns("sos_events")}
    assert {"sent_at", "note", "accuracy_m", "guardian_name"} <= cols
