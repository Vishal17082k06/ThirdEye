import io

import pytest
from PIL import Image
from sqlalchemy import select

from app.main import app
from app.models import Event, Notification
from app.services import detector as d
from app.services.detector import Detector, DetectionResult, make_detection
from tests.test_auth import auth_header, register


def png(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, "PNG")
    return buf.getvalue()


class FakeDetector:
    def __init__(self, detections=()):
        self.detections = list(detections)
        self.calls = []

    def detect(self, image_bytes, conf=0.5):
        self.calls.append(conf)
        return DetectionResult(self.detections, 64, 48, 12.3)


PERSON_AHEAD_BIG = make_detection("person", 0.91, {"x": 0.3, "y": 0.1, "w": 0.4, "h": 0.8})  # critical
CHAIR_LEFT_SMALL = make_detection("chair", 0.8, {"x": 0.05, "y": 0.5, "w": 0.1, "h": 0.2})  # low
CAR_MID = make_detection("car", 0.7, {"x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2})  # medium (.04)


@pytest.fixture()
def auth(client):
    r = register(client)
    return auth_header(r.json()["token"]), r.json()["user"]["id"]


@pytest.fixture()
def fake():
    f = FakeDetector()
    app.dependency_overrides[d.get_detector] = lambda: f
    yield f
    app.dependency_overrides.pop(d.get_detector, None)


def post(client, headers, data=None, content=None, name="a.png", ctype="image/png"):
    files = {"file": (name, png() if content is None else content, ctype)}
    return client.post("/api/detect", files=files, data=data or {}, headers=headers)


def test_requires_auth(client, fake):
    assert post(client, {}).status_code == 401


def test_response_shape(client, auth, fake):
    fake.detections = [PERSON_AHEAD_BIG]
    r = post(client, auth[0])
    assert r.status_code == 200
    assert r.json() == {
        "detections": [
            {
                "label": "person",
                "confidence": 0.91,
                "box": {"x": 0.3, "y": 0.1, "w": 0.4, "h": 0.8},
                "position": "ahead",
                "risk": "critical",
                "announcement": "Person detected ahead.",
            }
        ],
        "summary": {"text": "Person detected ahead.", "highest_risk": "critical"},
        "image": {"width": 64, "height": 48},
        "inference_ms": 12.3,
        "source": "live",
        "model": "yolov8n-onnx",
    }


def test_no_detections_exact_clear_text(client, auth, fake):
    body = post(client, auth[0]).json()
    assert body["detections"] == []
    assert body["summary"] == {
        "text": "Path appears clear in the current camera view.",
        "highest_risk": None,
    }


def test_source_simulation_and_invalid_source(client, auth, fake):
    assert post(client, auth[0], {"source": "simulation"}).json()["source"] == "simulation"
    assert post(client, auth[0], {"source": "hardware"}).status_code == 422


def test_conf_explicit_overrides_settings(client, auth, fake):
    post(client, auth[0], {"conf": "0.3"})
    assert fake.calls == [0.3]


@pytest.mark.parametrize("bad", ["0.01", "0.99", "abc"])
def test_conf_out_of_range_422(client, auth, fake, bad):
    assert post(client, auth[0], {"conf": bad}).status_code == 422


def test_conf_defaults_to_user_setting(client, auth, fake):
    post(client, auth[0])
    assert fake.calls[-1] == 0.5
    client.put("/api/settings", json={"ai": {"confidenceThreshold": 0.7}}, headers=auth[0])
    post(client, auth[0])
    assert fake.calls[-1] == 0.7


def test_non_image_rejected(client, auth):
    # Real Detector (no model needed: image validation happens first).
    app.dependency_overrides[d.get_detector] = lambda: Detector("missing.onnx")
    try:
        r = post(client, auth[0], content=b"not an image", name="a.txt", ctype="text/plain")
    finally:
        app.dependency_overrides.pop(d.get_detector, None)
    assert r.status_code == 422 and r.json()["detail"] == "Could not read image"


def test_pixel_bomb_413(client, auth):
    app.dependency_overrides[d.get_detector] = lambda: Detector("missing.onnx")
    buf = io.BytesIO()
    Image.new("L", (6000, 5000)).save(buf, "PNG")
    try:
        r = post(client, auth[0], content=buf.getvalue())
    finally:
        app.dependency_overrides.pop(d.get_detector, None)
    assert r.status_code == 413


def test_truncated_image_422_not_500(client, auth):
    import numpy as np

    buf = io.BytesIO()
    rng = np.random.default_rng(2)
    Image.fromarray(rng.integers(0, 255, (200, 200, 3), dtype=np.uint8)).save(buf, "JPEG")
    app.dependency_overrides[d.get_detector] = lambda: Detector("missing.onnx")
    try:
        r = post(client, auth[0], content=buf.getvalue()[:2000], ctype="image/jpeg")
    finally:
        app.dependency_overrides.pop(d.get_detector, None)
    assert r.status_code == 422


def test_corrupt_model_503(client, auth, tmp_path):
    bad = tmp_path / "bad.onnx"
    bad.write_bytes(b"nope")
    app.dependency_overrides[d.get_detector] = lambda: Detector(bad)
    try:
        r = post(client, auth[0])
    finally:
        app.dependency_overrides.pop(d.get_detector, None)
    assert r.status_code == 503 and "could not be loaded" in r.json()["detail"]


def test_oversized_413(client, auth):
    app.dependency_overrides[d.get_detector] = lambda: Detector("missing.onnx")
    try:
        r = post(client, auth[0], content=b"0" * (d.MAX_IMAGE_BYTES + 5))
    finally:
        app.dependency_overrides.pop(d.get_detector, None)
    assert r.status_code == 413


def test_missing_model_503_without_fake_results(client, auth, tmp_path):
    app.dependency_overrides[d.get_detector] = lambda: Detector(tmp_path / "nope.onnx")
    try:
        r = post(client, auth[0])
    finally:
        app.dependency_overrides.pop(d.get_detector, None)
    assert r.status_code == 503
    assert r.json() == {"detail": "Detection model not found. Run backend/scripts/export_model.py"}


def test_missing_file_field_422(client, auth, fake):
    assert client.post("/api/detect", headers=auth[0]).status_code == 422


def events_and_notes(client):
    with client.session_factory() as db:
        return db.scalars(select(Event)).all(), db.scalars(select(Notification)).all()


def test_record_false_creates_nothing(client, auth, fake):
    fake.detections = [PERSON_AHEAD_BIG]
    post(client, auth[0])
    assert events_and_notes(client) == ([], [])


def test_record_critical_creates_obstacle_event_and_notification(client, auth, fake):
    fake.detections = [PERSON_AHEAD_BIG, CHAIR_LEFT_SMALL]
    assert post(client, auth[0], {"record": "true", "source": "simulation"}).status_code == 200
    events, notes = events_and_notes(client)
    (e,) = events
    assert (e.type, e.source, e.title) == ("obstacle", "simulation", "Person detected ahead.")
    assert e.details["count"] == 2 and e.details["top_label"] == "person"
    assert e.details["highest_risk"] == "critical"
    (n,) = notes
    assert n.kind == "obstacle" and n.source == "simulation" and n.title == "Person detected ahead."


def test_record_medium_event_without_notification(client, auth, fake):
    fake.detections = [CAR_MID]
    assert CAR_MID.risk == "medium"
    post(client, auth[0], {"record": "true"})
    events, notes = events_and_notes(client)
    assert [e.type for e in events] == ["obstacle"] and notes == []


def test_record_low_or_empty_is_ai_analysis(client, auth, fake):
    fake.detections = [CHAIR_LEFT_SMALL]
    post(client, auth[0], {"record": "true"})
    fake.detections = []
    post(client, auth[0], {"record": "true"})
    events, notes = events_and_notes(client)
    assert [e.type for e in events] == ["ai_analysis", "ai_analysis"] and notes == []
    assert events[0].title == "Objects detected in view, none close."
    assert events[1].title == "Path appears clear in the current camera view."
    assert events[1].details["top_label"] is None


def test_record_event_belongs_to_caller(client, auth, fake):
    fake.detections = [PERSON_AHEAD_BIG]
    post(client, auth[0], {"record": "true"})
    events, _ = events_and_notes(client)
    assert events[0].user_id == auth[1]


@pytest.mark.skipif(not d.MODEL_PATH.is_file(), reason="models/yolov8n.onnx absent; run scripts/export_model.py")
def test_real_model_end_to_end_via_api(client, auth):
    from pathlib import Path

    data = (Path(__file__).parent / "data" / "bus.jpg").read_bytes()
    r = post(client, auth[0], {"conf": "0.4"}, content=data, name="bus.jpg", ctype="image/jpeg")
    assert r.status_code == 200
    body = r.json()
    labels = {x["label"] for x in body["detections"]}
    assert {"person", "bus"} <= labels
    assert body["image"] == {"width": 810, "height": 1080} and body["model"] == "yolov8n-onnx"
