import re

import pytest

from app.geo import RESTRICTION_MESSAGE
from app.routers.rides import generate_booking_id
from app.config import settings
from tests.test_auth import auth_header, register

DISCLAIMER = (
    "This is a Third Eye ride request (demo). "
    "No driver has been assigned and no real ride has been booked."
)
FARE_NOTE = "Estimate using demo rates — not a real fare."
PICKUP = {"lat": 11.0168, "lon": 76.9558, "label": "Coimbatore Junction"}
DEST = {"lat": 11.0300, "lon": 76.9700, "label": "Gandhipuram"}  # ~2.1 km straight line


def body(**over):
    b = {"pickup": dict(PICKUP), "destination": dict(DEST), "mode": "car", "distance_m": 2800, "duration_s": 600}
    b.update(over)
    return b


@pytest.fixture()
def h(client):
    return auth_header(register(client, email="rider@example.com").json()["token"])


def book(client, h, **over):
    return client.post("/api/rides", json=body(**over), headers=h)


def test_auth_required(client):
    assert client.post("/api/rides", json=body()).status_code == 401
    assert client.get("/api/rides").status_code == 401
    assert client.get("/api/rides/1").status_code == 401
    assert client.post("/api/rides/1/cancel").status_code == 401


def test_create_shape(client, h):
    r = book(client, h)
    assert r.status_code == 201
    d = r.json()
    assert set(d) == {
        "id", "booking_id", "pickup", "destination", "mode", "distance_m", "duration_s",
        "fare_estimate", "fare_note", "status", "created_at", "disclaimer",
    }  # fmt: skip
    assert d["status"] == "requested" and d["mode"] == "car"
    assert d["pickup"] == PICKUP and d["destination"] == DEST
    assert d["disclaimer"] == DISCLAIMER and d["fare_note"] == FARE_NOTE
    assert re.fullmatch(r"TE-\d{8}-[A-HJ-NP-Z2-9]{4}", d["booking_id"])
    assert d["created_at"].endswith("Z")


def test_fare_calc(client, h):
    assert settings.ride_base_fare_inr == 30
    car = book(client, h, mode="car", distance_m=2800).json()
    assert car["fare_estimate"] == round(30 + 14 * 2.8)  # 69
    bike = book(client, h, mode="bike", distance_m=2800).json()
    assert bike["fare_estimate"] == round(30 + 8 * 2.8)  # 52


def test_fare_uses_configured_rates(client, h, monkeypatch):
    monkeypatch.setattr(settings, "ride_base_fare_inr", 50)
    monkeypatch.setattr(settings, "ride_per_km_car", 10)
    assert book(client, h, distance_m=3000).json()["fare_estimate"] == 80


def test_walk_has_no_fare(client, h):
    d = book(client, h, mode="walk").json()
    assert d["fare_estimate"] is None and d["fare_note"] is None
    assert d["disclaimer"] == DISCLAIMER


def test_client_fare_ignored(client, h):
    d = book(client, h, fare_estimate=1).json()
    assert d["fare_estimate"] == 69


@pytest.mark.parametrize("which", ["pickup", "destination"])
def test_outside_area_names_the_point(client, h, which):
    pt = {"lat": 13.08, "lon": 80.27, "label": "Chennai"}
    r = book(client, h, **{which: pt})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert which in detail.lower() and RESTRICTION_MESSAGE in detail


def test_boundary_edge_accepted(client, h):
    r = book(client, h, pickup={"lat": 10.85, "lon": 76.85, "label": "Edge"},
             destination={"lat": 10.86, "lon": 76.86, "label": "Near edge"}, distance_m=1800)  # fmt: skip
    assert r.status_code == 201


@pytest.mark.parametrize(
    "over",
    [
        {"distance_m": 0}, {"distance_m": -5}, {"duration_s": 0}, {"duration_s": -1},
        {"mode": "plane"}, {"mode": "foot"},
        {"pickup": {**PICKUP, "label": ""}}, {"destination": {**DEST, "label": "x" * 201}},
        {"pickup": {**PICKUP, "lat": "abc"}}, {"pickup": {"lat": 11.0, "lon": 76.9}},
    ],
)  # fmt: skip
def test_field_validation(client, h, over):
    assert book(client, h, **over).status_code == 422


def test_nan_and_inf_rejected(client, h):
    r = client.post(
        "/api/rides",
        content='{"pickup":{"lat":NaN,"lon":76.9,"label":"a"},"destination":{"lat":11.03,"lon":76.97,"label":"b"},'
        '"mode":"car","distance_m":2800,"duration_s":600}',
        headers={**h, "content-type": "application/json"},
    )
    assert r.status_code == 422
    r = client.post(
        "/api/rides",
        content='{"pickup":{"lat":11.0168,"lon":76.9558,"label":"a"},"destination":{"lat":11.03,"lon":76.97,"label":"b"},'
        '"mode":"car","distance_m":1e999,"duration_s":600}',
        headers={**h, "content-type": "application/json"},
    )
    assert r.status_code == 422


def test_same_place_rejected(client, h):
    near = {"lat": 11.01685, "lon": 76.95585, "label": "Same spot"}  # ~7 m away
    r = book(client, h, destination=near, distance_m=100)
    assert r.status_code == 422
    assert "different" in r.json()["detail"].lower()


def test_distance_plausibility(client, h):
    # straight line is about 2.1 km
    assert book(client, h, distance_m=1000).status_code == 422
    r = book(client, h, distance_m=30000)
    assert r.status_code == 422 and r.json()["detail"] == "distance does not match the route"
    assert book(client, h, distance_m=2000).status_code == 201


def test_booking_id_generator():
    ids = {generate_booking_id() for _ in range(300)}
    assert len(ids) > 250
    for i in ids:
        assert re.fullmatch(r"TE-\d{8}-[A-HJ-NP-Z2-9]{4}", i)
        assert not set(i[-4:]) & set("01OI")


def test_booking_id_unique_with_retry(client, h, monkeypatch):
    first = book(client, h).json()["booking_id"]
    seq = iter([first, first, "TE-20300101-ABCD"])
    monkeypatch.setattr("app.routers.rides.generate_booking_id", lambda: next(seq))
    r = book(client, h)
    assert r.status_code == 201 and r.json()["booking_id"] == "TE-20300101-ABCD"


def test_list_newest_first_scoped_paged(client, h):
    ids = [book(client, h, distance_m=2800 + i).json()["id"] for i in range(3)]
    other = auth_header(register(client, email="other@example.com").json()["token"])
    book(client, other)
    r = client.get("/api/rides", headers=h).json()
    assert [x["id"] for x in r["items"]] == ids[::-1]
    assert r["total"] == 3 and r["limit"] == 50 and r["offset"] == 0
    page = client.get("/api/rides?limit=1&offset=1", headers=h).json()
    assert [x["id"] for x in page["items"]] == [ids[1]] and page["total"] == 3
    assert client.get("/api/rides?limit=0", headers=h).status_code == 422
    assert client.get("/api/rides", headers=other).json()["total"] == 1


def test_get_and_cross_user_isolation(client, h):
    rid = book(client, h).json()["id"]
    assert client.get(f"/api/rides/{rid}", headers=h).json()["id"] == rid
    other = auth_header(register(client, email="other@example.com").json()["token"])
    assert client.get(f"/api/rides/{rid}", headers=other).status_code == 404
    assert client.post(f"/api/rides/{rid}/cancel", headers=other).status_code == 404
    assert client.get(f"/api/rides/{rid}", headers=h).json()["status"] == "requested"
    assert client.get("/api/rides/99999", headers=h).status_code == 404


def test_cancel_rules(client, h):
    rid = book(client, h).json()["id"]
    r = client.post(f"/api/rides/{rid}/cancel", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert r.json()["disclaimer"] == DISCLAIMER
    again = client.post(f"/api/rides/{rid}/cancel", headers=h)
    assert again.status_code == 409


def test_cancel_non_requested_conflicts(client, h):
    from app.models import Ride

    rid = book(client, h).json()["id"]
    with client.session_factory() as db:
        db.get(Ride, rid).status = "completed"
        db.commit()
    assert client.post(f"/api/rides/{rid}/cancel", headers=h).status_code == 409


def test_events_and_notifications_logged(client, h):
    rid = book(client, h).json()
    client.post(f"/api/rides/{rid['id']}/cancel", headers=h)
    events = client.get("/api/events?type=ride", headers=h).json()["items"]
    assert len(events) == 2
    titles = " ".join(e["title"] for e in events)
    assert rid["booking_id"] in titles and "cancel" in titles.lower()
    assert all(e["source"] == "live" for e in events)
    notes = client.get("/api/notifications", headers=h).json()["items"]
    assert len(notes) == 2 and all(n["kind"] == "booking" and n["source"] == "live" for n in notes)
    assert all("driver" not in n["title"].lower() or "no driver" in n["body"].lower() for n in notes)
