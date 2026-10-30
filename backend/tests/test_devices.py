import pytest
from sqlalchemy import select

from app.models import Device, Event, Notification
from tests.test_auth import auth_header, register


def signup(client, email="asha@example.com"):
    r = register(client, email=email)
    assert r.status_code == 201
    return auth_header(r.json()["token"])


@pytest.fixture()
def h(client):
    return signup(client)


def devices(client, h):
    r = client.get("/api/devices", headers=h)
    assert r.status_code == 200
    return {d["key"]: d for d in r.json()["items"]}


def events_of_type(client, h, type_="device"):
    return client.get(f"/api/events?type={type_}", headers=h).json()["items"]


def test_requires_auth(client):
    assert client.get("/api/devices").status_code == 401
    assert client.put("/api/devices/battery", json={}).status_code == 401
    assert client.post("/api/devices/laptop_camera/report", json={}).status_code == 401
    assert client.post("/api/devices/vl53l0x/heartbeat", json={}).status_code == 401


def test_initial_seed_exact(client, h):
    r = client.get("/api/devices", headers=h)
    items = r.json()["items"]
    assert [(d["key"], d["name"], d["status"]) for d in items] == [
        ("laptop_camera", "Laptop/USB Camera", "unknown"),
        ("esp32_cam", "ESP32-CAM", "not_integrated"),
        ("vl53l0x", "VL53L0X Distance Sensor", "disconnected"),
        ("vibration_motor", "Vibration Motor", "not_integrated"),
        ("battery", "Battery Monitoring", "not_integrated"),
    ]
    for d in items:
        assert set(d) == {"key", "name", "status", "last_seen", "config", "error"}
        assert d["last_seen"] is None and d["config"] == {} and d["error"] is None


def test_seed_is_idempotent_and_per_user(client, h):
    devices(client, h)
    devices(client, h)
    other = signup(client, "b@example.com")
    devices(client, other)
    with client.session_factory() as db:
        assert len(db.scalars(select(Device)).all()) == 10


def test_put_config_merges_and_never_changes_status(client, h):
    r = client.put("/api/devices/esp32_cam", headers=h, json={"config": {"deviceIp": "10.0.0.5"}})
    assert r.status_code == 200
    assert r.json()["config"] == {"deviceIp": "10.0.0.5"}
    assert r.json()["status"] == "not_integrated"
    r = client.put("/api/devices/esp32_cam", headers=h, json={"config": {"port": 81}})
    assert r.json()["config"] == {"deviceIp": "10.0.0.5", "port": 81}
    assert devices(client, h)["esp32_cam"]["config"]["deviceIp"] == "10.0.0.5"
    assert devices(client, h)["esp32_cam"]["status"] == "not_integrated"


@pytest.mark.parametrize("body", [{"status": "connected"}, {"config": {}, "status": "connected"}])
def test_put_cannot_set_status(client, h, body):
    assert client.put("/api/devices/vl53l0x", headers=h, json=body).status_code == 422
    assert devices(client, h)["vl53l0x"]["status"] == "disconnected"


def test_unknown_key_404(client, h):
    assert client.put("/api/devices/toaster", headers=h, json={"config": {}}).status_code == 404
    r = client.post("/api/devices/toaster/report", headers=h, json={"status": "connected"})
    assert r.status_code == 404
    body = {"source": "hardware", "info": {}}
    assert client.post("/api/devices/toaster/heartbeat", headers=h, json=body).status_code == 404


# ---------- browser report (laptop camera only) ----------


def test_report_camera_connected(client, h):
    r = client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "connected" and body["error"] is None
    assert body["last_seen"].endswith("Z")
    ev = events_of_type(client, h)
    assert len(ev) == 1 and ev[0]["source"] == "live" and ev[0]["type"] == "device"
    assert client.get("/api/notifications", headers=h).json()["unread_count"] == 0


def test_report_camera_error_has_message_and_notifies(client, h):
    client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    r = client.post(
        "/api/devices/laptop_camera/report",
        headers=h,
        json={"status": "error", "error": "Permission denied"},
    )
    assert r.json()["status"] == "error" and r.json()["error"] == "Permission denied"
    notes = client.get("/api/notifications", headers=h).json()
    assert notes["unread_count"] == 1 and notes["items"][0]["source"] == "live"
    r = client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    assert r.json()["error"] is None


def test_report_camera_disconnected_notifies(client, h):
    client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "disconnected"})
    assert client.get("/api/notifications", headers=h).json()["unread_count"] == 1


def test_report_same_status_updates_last_seen_without_new_event(client, h):
    first = client.post(
        "/api/devices/laptop_camera/report", headers=h, json={"status": "connected"}
    ).json()["last_seen"]
    second = client.post(
        "/api/devices/laptop_camera/report", headers=h, json={"status": "connected"}
    ).json()["last_seen"]
    assert second >= first
    assert len(events_of_type(client, h)) == 1
    with client.session_factory() as db:
        d = db.scalars(select(Device).where(Device.key == "laptop_camera")).one()
        assert d.last_seen is not None


@pytest.mark.parametrize("key", ["esp32_cam", "vl53l0x", "vibration_motor", "battery"])
def test_report_other_keys_400(client, h, key):
    r = client.post(f"/api/devices/{key}/report", headers=h, json={"status": "connected"})
    assert r.status_code == 400
    assert devices(client, h)[key]["status"] in ("not_integrated", "disconnected")


@pytest.mark.parametrize("status", ["not_integrated", "unknown", "bogus"])
def test_report_invalid_status_422(client, h, status):
    r = client.post("/api/devices/laptop_camera/report", headers=h, json={"status": status})
    assert r.status_code == 422


# ---------- hardware heartbeat ----------


def test_heartbeat_connects_vl53l0x(client, h):
    r = client.post(
        "/api/devices/vl53l0x/heartbeat",
        headers=h,
        json={"source": "hardware", "info": {"firmware": "1.2", "distance_mm": 420}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "connected" and body["last_seen"].endswith("Z")
    assert body["config"]["lastInfo"] == {"firmware": "1.2", "distance_mm": 420}
    ev = events_of_type(client, h)
    assert len(ev) == 1 and ev[0]["source"] == "hardware"


def test_heartbeat_keeps_user_config(client, h):
    client.put("/api/devices/esp32_cam", headers=h, json={"config": {"deviceIp": "1.2.3.4"}})
    r = client.post(
        "/api/devices/esp32_cam/heartbeat", headers=h, json={"source": "hardware", "info": {}}
    )
    assert r.json()["status"] == "connected"
    assert r.json()["config"]["deviceIp"] == "1.2.3.4"


@pytest.mark.parametrize("source", ["simulation", "live", "", "HARDWARE-ish"])
def test_heartbeat_rejects_non_hardware_source(client, h, source):
    r = client.post(
        "/api/devices/vl53l0x/heartbeat", headers=h, json={"source": source, "info": {}}
    )
    assert r.status_code == 422
    assert "hardware" in r.text
    assert devices(client, h)["vl53l0x"]["status"] == "disconnected"
    assert devices(client, h)["vl53l0x"]["last_seen"] is None


def test_heartbeat_requires_source(client, h):
    r = client.post("/api/devices/vl53l0x/heartbeat", headers=h, json={"info": {}})
    assert r.status_code == 422


@pytest.mark.parametrize("key", ["laptop_camera", "vibration_motor", "battery"])
def test_heartbeat_not_allowed_for_other_devices(client, h, key):
    before = devices(client, h)[key]["status"]
    r = client.post(
        f"/api/devices/{key}/heartbeat", headers=h, json={"source": "hardware", "info": {}}
    )
    assert r.status_code == 400
    assert devices(client, h)[key]["status"] == before


def test_heartbeat_twice_updates_last_seen_one_event(client, h):
    body = {"source": "hardware", "info": {}}
    a = client.post("/api/devices/vl53l0x/heartbeat", headers=h, json=body).json()["last_seen"]
    b = client.post("/api/devices/vl53l0x/heartbeat", headers=h, json=body).json()["last_seen"]
    assert b >= a
    assert len(events_of_type(client, h)) == 1


# ---------- the core invariants ----------


def test_simulation_events_cannot_flip_status(client, h):
    before = devices(client, h)
    r = client.post(
        "/api/events",
        headers=h,
        json={"type": "distance_reading", "source": "simulation", "title": "sim",
              "details": {"device": "vl53l0x"}},
    )
    assert r.status_code == 201
    # clients cannot post device events, or claim a hardware source, at all
    for body in (
        {"type": "device", "source": "simulation", "title": "sim"},
        {"type": "distance_reading", "source": "hardware", "title": "sim"},
    ):
        assert client.post("/api/events", headers=h, json=body).status_code == 422
    r = client.post(
        "/api/devices/vl53l0x/heartbeat", headers=h, json={"source": "simulation", "info": {}}
    )
    assert r.status_code == 422
    after = devices(client, h)
    assert {k: v["status"] for k, v in after.items()} == {k: v["status"] for k, v in before.items()}
    assert after["vl53l0x"]["last_seen"] is None


def test_laptop_camera_and_esp32_are_independent(client, h):
    client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    d = devices(client, h)
    assert d["laptop_camera"]["status"] == "connected"
    assert d["esp32_cam"]["status"] == "not_integrated" and d["esp32_cam"]["last_seen"] is None

    client.post(
        "/api/devices/esp32_cam/heartbeat", headers=h, json={"source": "hardware", "info": {}}
    )
    client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "disconnected"})
    d = devices(client, h)
    assert d["esp32_cam"]["status"] == "connected"
    assert d["laptop_camera"]["status"] == "disconnected"


def test_devices_isolated_between_users(client, h):
    client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    other = signup(client, "b@example.com")
    assert devices(client, other)["laptop_camera"]["status"] == "unknown"
    assert events_of_type(client, other) == []
    with client.session_factory() as db:
        assert db.scalars(select(Event).where(Event.user_id != 1)).all() == []
        assert db.scalars(select(Notification)).all() == []


# ---------- staleness (fix round 1) ----------

from datetime import datetime, timedelta, timezone  # noqa: E402


def backdate(client, key, seconds, status="connected"):
    with client.session_factory() as db:
        d = db.scalars(select(Device).where(Device.key == key)).one()
        d.status = status
        d.last_seen = datetime.now(timezone.utc) - timedelta(seconds=seconds)
        db.commit()


def set_polling(client, h, ms):
    assert client.put("/api/settings", headers=h, json={"hardware": {"pollingIntervalMs": ms}}).status_code == 200


def test_hardware_fresh_heartbeat_stays_connected(client, h):
    devices(client, h)
    backdate(client, "vl53l0x", 10)
    assert devices(client, h)["vl53l0x"]["status"] == "connected"


def test_hardware_stale_becomes_disconnected_once(client, h):
    devices(client, h)
    backdate(client, "vl53l0x", 20)
    d = devices(client, h)["vl53l0x"]
    assert d["status"] == "disconnected"
    assert d["error"].startswith("No heartbeat for ") and "last seen" in d["error"]
    again = devices(client, h)["vl53l0x"]
    assert again["status"] == "disconnected"
    evs = events_of_type(client, h)
    assert len(evs) == 1 and evs[0]["source"] == "hardware"
    notes = client.get("/api/notifications", headers=h).json()
    assert notes["unread_count"] == 1 and notes["items"][0]["title"] == "Sensor disconnected"


def test_stale_threshold_scales_with_polling_interval(client, h):
    devices(client, h)
    set_polling(client, h, 10000)  # threshold = 30 s
    backdate(client, "vl53l0x", 20)
    assert devices(client, h)["vl53l0x"]["status"] == "connected"
    backdate(client, "vl53l0x", 40)
    assert devices(client, h)["vl53l0x"]["status"] == "disconnected"


def test_stale_esp32_disconnected(client, h):
    devices(client, h)
    backdate(client, "esp32_cam", 60)
    assert devices(client, h)["esp32_cam"]["status"] == "disconnected"


def test_heartbeat_after_stale_reconnects_and_logs(client, h):
    devices(client, h)
    backdate(client, "vl53l0x", 60)
    assert devices(client, h)["vl53l0x"]["status"] == "disconnected"
    r = client.post(
        "/api/devices/vl53l0x/heartbeat", headers=h, json={"source": "hardware", "info": {}}
    )
    assert r.json()["status"] == "connected" and r.json()["error"] is None
    assert len(events_of_type(client, h)) == 3 - 1  # disconnected + connected


def test_stale_applied_in_put_response(client, h):
    devices(client, h)
    backdate(client, "vl53l0x", 60)
    r = client.put("/api/devices/vl53l0x", headers=h, json={"config": {"deviceIp": "1.1.1.1"}})
    assert r.json()["status"] == "disconnected"


def test_laptop_camera_stale_becomes_unknown(client, h):
    devices(client, h)
    backdate(client, "laptop_camera", 30)
    assert devices(client, h)["laptop_camera"]["status"] == "connected"
    backdate(client, "laptop_camera", 90)
    d = devices(client, h)["laptop_camera"]
    assert d["status"] == "unknown" and d["error"] == "Browser has not reported recently"
    notes = client.get("/api/notifications", headers=h).json()
    assert notes["items"][0]["title"] == "Camera disconnected"
    r = client.post("/api/devices/laptop_camera/report", headers=h, json={"status": "connected"})
    assert r.json()["status"] == "connected"


def test_stale_transition_race_fires_once(client, h):
    from app.routers import devices as dev_router
    from app.models import User

    devices(client, h)
    backdate(client, "vl53l0x", 60)
    with client.session_factory() as a, client.session_factory() as b:
        user = a.get(User, 1)
        da = dev_router._ensure_seeded(a, user)
        db_ = dev_router._ensure_seeded(b, user)
        dev_router._expire_stale(a, user, da)
        dev_router._expire_stale(b, user, db_)
    assert len(events_of_type(client, h)) == 1
    assert client.get("/api/notifications", headers=h).json()["unread_count"] == 1


# ---------- payload caps ----------


def test_heartbeat_info_size_and_depth_caps(client, h):
    url = "/api/devices/vl53l0x/heartbeat"
    big = {"source": "hardware", "info": {"x": "a" * 5000}}
    assert client.post(url, headers=h, json=big).status_code == 422
    deep = {"source": "hardware", "info": {"a": {"b": {"c": {"d": 1}}}}}
    assert client.post(url, headers=h, json=deep).status_code == 422
    ok = {"source": "hardware", "info": {"a": {"b": {"c": 1}}}}
    assert client.post(url, headers=h, json=ok).status_code == 200


def test_put_config_cannot_set_last_info(client, h):
    r = client.put("/api/devices/vl53l0x", headers=h, json={"config": {"lastInfo": {"x": 1}}})
    assert r.status_code == 422


def test_put_config_size_cap(client, h):
    r = client.put("/api/devices/vl53l0x", headers=h, json={"config": {"x": "a" * 17000}})
    assert r.status_code == 422
