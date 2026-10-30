from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models import Event, Notification
from app.services.events import record_event
from tests.test_auth import auth_header, register


def signup(client, email="asha@example.com"):
    r = register(client, email=email)
    assert r.status_code == 201
    return auth_header(r.json()["token"]), r.json()["user"]["id"]


@pytest.fixture()
def me(client):
    return signup(client)


def seed(client, user_id, **kw):
    """Insert an event directly with an explicit timestamp."""
    with client.session_factory() as db:
        e = Event(
            user_id=user_id,
            type=kw.get("type", "obstacle"),
            source=kw.get("source", "live"),
            title=kw.get("title", "Event"),
            details=kw.get("details", {}),
            status="ok",
            created_at=kw.get("created_at", datetime.now(timezone.utc)),
        )
        db.add(e)
        db.commit()
        return e.id


# ---------- record_event service ----------


def test_record_event_basic(client, me):
    _, uid = me
    with client.session_factory() as db:
        e = record_event(db, uid, "obstacle", "Chair ahead", details={"d": 1.2})
        assert e.id and e.source == "live" and e.status == "ok" and e.details == {"d": 1.2}
        assert db.scalars(select(Notification)).all() == []


def test_record_event_defaults_details_to_empty(client, me):
    _, uid = me
    with client.session_factory() as db:
        assert record_event(db, uid, "ride", "Booked").details == {}


def test_record_event_with_notification(client, me):
    _, uid = me
    with client.session_factory() as db:
        record_event(
            db,
            uid,
            "device",
            "Camera disconnected",
            source="hardware",
            status="error",
            notify={"kind": "device", "title": "Camera lost", "body": "No signal"},
        )
        n = db.scalars(select(Notification)).one()
        assert (n.user_id, n.kind, n.title, n.body, n.source, n.read) == (
            uid, "device", "Camera lost", "No signal", "hardware", False,
        )


@pytest.mark.parametrize("kwargs", [{"type": "bogus"}, {"source": "fake"}])
def test_record_event_rejects_bad_values(client, me, kwargs):
    _, uid = me
    args = {"type": "obstacle", "source": "live", **kwargs}
    with client.session_factory() as db:
        with pytest.raises(ValueError):
            record_event(db, uid, args["type"], "x", source=args["source"])
        assert db.scalars(select(Event)).all() == []


# ---------- GET /api/events ----------


def test_events_require_auth(client):
    assert client.get("/api/events").status_code == 401
    assert client.get("/api/events/1").status_code == 401
    assert client.post("/api/events", json={}).status_code == 401
    assert client.get("/api/notifications").status_code == 401


def test_list_newest_first_with_z_timestamps(client, me):
    h, uid = me
    seed(client, uid, title="old", created_at=datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))
    seed(client, uid, title="new", created_at=datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc))
    r = client.get("/api/events", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert [e["title"] for e in body["items"]] == ["new", "old"]
    assert body["items"][0]["created_at"] == "2026-01-02T10:00:00Z"
    assert body["total"] == 2 and body["limit"] == 50 and body["offset"] == 0
    assert set(body["items"][0]) == {
        "id", "type", "source", "title", "details", "status", "created_at",
    }


def test_filter_type_and_source(client, me):
    h, uid = me
    seed(client, uid, type="obstacle", source="live")
    seed(client, uid, type="obstacle", source="simulation")
    seed(client, uid, type="ride", source="live")
    assert client.get("/api/events?type=obstacle", headers=h).json()["total"] == 2
    assert client.get("/api/events?source=simulation", headers=h).json()["total"] == 1
    assert client.get("/api/events?type=obstacle&source=live", headers=h).json()["total"] == 1


def test_filter_invalid_type_422(client, me):
    h, _ = me
    assert client.get("/api/events?type=bogus", headers=h).status_code == 422
    assert client.get("/api/events?source=bogus", headers=h).status_code == 422


def test_search_title_and_details(client, me):
    h, uid = me
    seed(client, uid, title="Chair ahead")
    seed(client, uid, title="Other", details={"label": "Bicycle"})
    seed(client, uid, title="Nothing")
    assert client.get("/api/events?q=chair", headers=h).json()["total"] == 1
    assert client.get("/api/events?q=BICYCLE", headers=h).json()["total"] == 1
    assert client.get("/api/events?q=%25", headers=h).json()["total"] == 0  # literal %


def test_date_range_inclusive(client, me):
    h, uid = me
    seed(client, uid, title="a", created_at=datetime(2026, 3, 1, 0, 0, 0, tzinfo=timezone.utc))
    seed(client, uid, title="b", created_at=datetime(2026, 3, 2, 23, 59, 59, tzinfo=timezone.utc))
    seed(client, uid, title="c", created_at=datetime(2026, 3, 3, 0, 0, 0, tzinfo=timezone.utc))
    seed(client, uid, title="z", created_at=datetime(2026, 2, 28, 23, 59, 59, tzinfo=timezone.utc))
    r = client.get("/api/events?from=2026-03-01&to=2026-03-02", headers=h)
    assert sorted(e["title"] for e in r.json()["items"]) == ["a", "b"]
    r = client.get("/api/events?from=2026-03-03", headers=h)
    assert [e["title"] for e in r.json()["items"]] == ["c"]
    r = client.get("/api/events?to=2026-02-28", headers=h)
    assert [e["title"] for e in r.json()["items"]] == ["z"]


def test_bad_date_422(client, me):
    h, _ = me
    assert client.get("/api/events?from=yesterday", headers=h).status_code == 422


def test_limit_offset(client, me):
    h, uid = me
    for i in range(5):
        seed(client, uid, title=f"e{i}", created_at=datetime(2026, 1, 1, i, tzinfo=timezone.utc))
    r = client.get("/api/events?limit=2&offset=1", headers=h).json()
    assert [e["title"] for e in r["items"]] == ["e3", "e2"]
    assert r["total"] == 5 and r["limit"] == 2 and r["offset"] == 1
    assert client.get("/api/events?limit=201", headers=h).status_code == 422
    assert client.get("/api/events?limit=0", headers=h).status_code == 422
    assert client.get("/api/events?offset=-1", headers=h).status_code == 422


def test_get_one_and_404(client, me):
    h, uid = me
    eid = seed(client, uid, title="Chair", details={"a": 1})
    r = client.get(f"/api/events/{eid}", headers=h)
    assert r.status_code == 200 and r.json()["details"] == {"a": 1}
    assert client.get("/api/events/9999", headers=h).status_code == 404


def test_events_isolated_between_users(client, me):
    h, uid = me
    other_h, other_uid = signup(client, "b@example.com")
    eid = seed(client, other_uid, title="secret")
    mine = seed(client, uid, title="mine")
    assert [e["title"] for e in client.get("/api/events", headers=h).json()["items"]] == ["mine"]
    assert client.get(f"/api/events/{eid}", headers=h).status_code == 404
    assert client.get(f"/api/events/{mine}", headers=other_h).status_code == 404
    assert client.get("/api/events?q=secret", headers=h).json()["total"] == 0


# ---------- POST /api/events ----------


def test_post_event(client, me):
    h, _ = me
    r = client.post(
        "/api/events",
        headers=h,
        json={"type": "camera_session", "title": "Camera started", "details": {"fps": 15}},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["source"] == "live" and body["status"] == "ok" and body["details"] == {"fps": 15}
    assert body["created_at"].endswith("Z")
    assert client.get("/api/events", headers=h).json()["total"] == 1


def test_post_event_with_notification(client, me):
    h, _ = me
    r = client.post(
        "/api/events",
        headers=h,
        json={
            "type": "obstacle",
            "source": "simulation",
            "title": "Obstacle",
            "notify": {"kind": "obstacle", "title": "Obstacle ahead", "body": "1 m"},
        },
    )
    assert r.status_code == 201
    n = client.get("/api/notifications", headers=h).json()
    assert n["unread_count"] == 1
    assert n["items"][0]["source"] == "simulation" and n["items"][0]["title"] == "Obstacle ahead"


@pytest.mark.parametrize(
    "body",
    [
        {"type": "bogus", "title": "x"},
        {"type": "obstacle", "title": "x", "source": "fake"},
        {"type": "obstacle", "title": ""},
        {"type": "obstacle"},
        {"type": "obstacle", "title": "x" * 201},
    ],
)
def test_post_event_validation_422(client, me, body):
    h, _ = me
    assert client.post("/api/events", headers=h, json=body).status_code == 422


# ---------- notifications ----------


def make_notes(client, uid, n=3):
    with client.session_factory() as db:
        for i in range(n):
            db.add(
                Notification(
                    user_id=uid,
                    kind="system",
                    title=f"n{i}",
                    body="b",
                    source="live",
                    created_at=datetime(2026, 1, 1, i, tzinfo=timezone.utc),
                )
            )
        db.commit()


def test_notifications_list_and_unread_count(client, me):
    h, uid = me
    make_notes(client, uid)
    r = client.get("/api/notifications", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert [n["title"] for n in body["items"]] == ["n2", "n1", "n0"]
    assert body["unread_count"] == 3
    assert body["items"][0]["created_at"] == "2026-01-01T02:00:00Z"
    assert set(body["items"][0]) == {
        "id", "kind", "title", "body", "source", "read", "created_at",
    }


def test_mark_read(client, me):
    h, uid = me
    make_notes(client, uid)
    nid = client.get("/api/notifications", headers=h).json()["items"][0]["id"]
    r = client.post(f"/api/notifications/{nid}/read", headers=h)
    assert r.status_code == 200 and r.json()["read"] is True
    assert client.get("/api/notifications", headers=h).json()["unread_count"] == 2
    assert client.post("/api/notifications/9999/read", headers=h).status_code == 404


def test_read_all(client, me):
    h, uid = me
    make_notes(client, uid)
    r = client.post("/api/notifications/read-all", headers=h)
    assert r.status_code == 200 and r.json() == {"updated": 3}
    body = client.get("/api/notifications", headers=h).json()
    assert body["unread_count"] == 0 and len(body["items"]) == 3


def test_clear_all(client, me):
    h, uid = me
    make_notes(client, uid)
    r = client.delete("/api/notifications", headers=h)
    assert r.status_code == 200 and r.json() == {"deleted": 3}
    assert client.get("/api/notifications", headers=h).json() == {"items": [], "unread_count": 0}


def test_notifications_isolated_between_users(client, me):
    h, uid = me
    other_h, other_uid = signup(client, "b@example.com")
    make_notes(client, other_uid, 2)
    make_notes(client, uid, 1)
    assert len(client.get("/api/notifications", headers=h).json()["items"]) == 1
    their_id = client.get("/api/notifications", headers=other_h).json()["items"][0]["id"]
    assert client.post(f"/api/notifications/{their_id}/read", headers=h).status_code == 404
    assert client.post("/api/notifications/read-all", headers=h).json() == {"updated": 1}
    assert client.get("/api/notifications", headers=other_h).json()["unread_count"] == 2
    assert client.delete("/api/notifications", headers=h).json() == {"deleted": 1}
    assert len(client.get("/api/notifications", headers=other_h).json()["items"]) == 2
