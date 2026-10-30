import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.services import detector as d
from app.services.detector import (
    CLEAR_TEXT,
    COCO_CLASSES,
    Detector,
    ImageTooLargeError,
    InvalidImageError,
    ModelLoadError,
    ModelNotFoundError,
    announcement,
    classify_risk,
    decode,
    letterbox,
    make_detection,
    nms,
    position_of,
    summarise,
    xywh_to_xyxy,
)

DATA = Path(__file__).parent / "data"


def det(label="person", x=0.4, y=0.2, w=0.2, h=0.6):
    return make_detection(label, 0.9, {"x": x, "y": y, "w": w, "h": h})


# ---------- letterbox ----------


def test_letterbox_wide_image_pads_top_and_bottom():
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    out, scale, (px, py) = letterbox(img, 640)
    assert out.shape == (640, 640, 3)
    assert scale == pytest.approx(3.2)
    assert (px, py) == (0, 160)
    assert out[0, 0].tolist() == [114, 114, 114]  # padding
    assert out[320, 320].tolist() == [0, 0, 0]  # image content


def test_letterbox_tall_image_pads_left_and_right():
    img = np.full((200, 100, 3), 255, dtype=np.uint8)
    out, scale, (px, py) = letterbox(img, 640)
    assert scale == pytest.approx(3.2)
    assert (px, py) == (160, 0)
    assert out[320, 0].tolist() == [114, 114, 114]
    assert out[320, 320].tolist() == [255, 255, 255]


def test_letterbox_square_has_no_padding():
    _, scale, pad = letterbox(np.zeros((320, 320, 3), dtype=np.uint8), 640)
    assert scale == 2.0 and pad == (0, 0)


# ---------- NMS ----------


def test_nms_removes_overlap_and_keeps_distinct_boxes():
    boxes = np.array([[0, 0, 100, 100], [5, 5, 105, 105], [300, 300, 400, 400]], np.float32)
    scores = np.array([0.8, 0.9, 0.7], np.float32)
    classes = np.array([0, 0, 0])
    assert nms(boxes, scores, classes) == [1, 2]


def test_nms_is_per_class():
    boxes = np.array([[0, 0, 100, 100], [5, 5, 105, 105]], np.float32)
    assert sorted(nms(boxes, np.array([0.8, 0.9], np.float32), np.array([0, 2]))) == [0, 1]


def test_nms_iou_boundary_keeps_box_at_threshold():
    # Two 10x10 boxes overlapping by 6.1 wide -> IoU = 61/139 ~ 0.44 (kept) ; 7 -> 70/130 (dropped)
    a = [0, 0, 10, 10]
    kept = nms(np.array([a, [3.9, 0, 13.9, 10]], np.float32), np.array([0.9, 0.8], np.float32), np.array([0, 0]))
    dropped = nms(np.array([a, [3, 0, 13, 10]], np.float32), np.array([0.9, 0.8], np.float32), np.array([0, 0]))
    assert kept == [0, 1] and dropped == [0]


def test_xywh_to_xyxy():
    out = xywh_to_xyxy(np.array([[50, 40, 20, 10]], np.float32))
    assert out.tolist() == [[40, 35, 60, 45]]


# ---------- decode ----------


def raw_output(rows):
    """Build a [1,84,N] tensor from (cx, cy, w, h, class_id, score) rows."""
    out = np.zeros((1, 84, len(rows) or 1), np.float32)
    for i, (cx, cy, w, h, cls, score) in enumerate(rows):
        out[0, :4, i] = (cx, cy, w, h)
        out[0, 4 + cls, i] = score
    return out


def test_decode_maps_back_to_original_and_normalises():
    # Original 200x100 -> scale 3.2, pad (0,160). Box centre (320,320) size 320x160 in letterbox
    # space is original centre (100,50) size 100x50 -> normalised x .25 y .25 w .5 h .5.
    out = raw_output([(320, 320, 320, 160, 0, 0.9)])
    (res,) = decode(out, 0.5, 3.2, (0, 160), (200, 100))
    assert res.label == "person" and res.confidence == pytest.approx(0.9)
    assert res.box == pytest.approx({"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5})
    assert res.position == "ahead"


def test_decode_filters_by_confidence_and_handles_empty():
    out = raw_output([(320, 320, 100, 100, 0, 0.4)])
    assert decode(out, 0.5, 1.0, (0, 0), (640, 640)) == []
    assert len(decode(out, 0.4, 1.0, (0, 0), (640, 640))) == 1


def test_decode_clips_boxes_to_image():
    out = raw_output([(10, 320, 100, 100, 2, 0.9)])  # sticks out of the left edge
    (res,) = decode(out, 0.5, 1.0, (0, 0), (640, 640))
    assert res.label == "car"
    assert res.box["x"] == 0.0 and res.box["w"] == pytest.approx(60 / 640)


def test_decode_applies_nms_and_picks_class():
    out = raw_output([(320, 320, 200, 200, 0, 0.9), (322, 322, 200, 200, 0, 0.6), (100, 100, 50, 50, 5, 0.8)])
    labels = sorted(r.label for r in decode(out, 0.5, 1.0, (0, 0), (640, 640)))
    assert labels == ["bus", "person"]


def test_coco_has_80_classes():
    assert len(COCO_CLASSES) == 80 and COCO_CLASSES[0] == "person" and COCO_CLASSES[79] == "toothbrush"


# ---------- position ----------


@pytest.mark.parametrize(
    "cx,expected",
    [(0.0, "left"), (0.329, "left"), (0.33, "ahead"), (0.5, "ahead"), (0.67, "ahead"), (0.671, "right"), (1.0, "right")],
)
def test_position_boundaries(cx, expected):
    assert position_of(cx) == expected


@pytest.mark.parametrize(
    "cx,w,expected",
    [
        (0.2, 0.0, "left"),
        (0.2, 0.5, "ahead"),  # [-.05,.45] overlaps the band by .12 > 25% of .34
        (0.2, 0.34, "left"),  # [.03,.37] overlaps by .04 < .085
        (0.8, 0.5, "ahead"),  # [.55,1.05] overlaps by .12
        (0.8, 0.34, "right"),
        (0.5, 0.02, "ahead"),  # centre in band, tiny box
        (0.1, 0.9, "ahead"),  # huge box spanning the whole band
    ],
)
def test_position_uses_central_band_overlap(cx, w, expected):
    assert position_of(cx, w) == expected


def test_band_overlap_boundary():
    # Overlap needed: > 0.25 * 0.34 = 0.085. Box [c-0.1, c+0.1]; right edge - 0.33 = overlap.
    assert position_of(0.33 + 0.08 - 0.1, 0.2) == "left"
    assert position_of(0.33 + 0.09 - 0.1, 0.2) == "ahead"


# ---------- risk ----------


@pytest.mark.parametrize(
    "label,area,pos,expected",
    [
        ("car", 0.25, "ahead", "critical"),
        ("car", 0.2499, "ahead", "high"),
        ("car", 0.10, "ahead", "high"),
        ("car", 0.0999, "ahead", "medium"),
        ("car", 0.03, "ahead", "medium"),
        ("car", 0.0299, "ahead", "low"),
        ("car", 0.25, "left", "high"),
        ("car", 0.03, "right", "low"),
        ("person", 0.20, "ahead", "critical"),
        ("person", 0.1999, "ahead", "high"),
        ("person", 0.08, "ahead", "high"),
        ("person", 0.02, "ahead", "medium"),
        ("person", 0.0199, "ahead", "low"),
        ("person", 0.20, "left", "high"),
        ("chair", 0.30, "ahead", "high"),
        ("chair", 0.2999, "ahead", "medium"),
        ("chair", 0.20, "ahead", "medium"),
        ("chair", 0.05, "ahead", "medium"),
        ("chair", 0.0499, "ahead", "low"),
        ("chair", 0.20, "right", "low"),
        ("chair", 0.9, "right", "medium"),  # capped: never high off-axis
        ("fire hydrant", 0.9, "ahead", "high"),  # static obstacles never critical
        ("stop sign", 0.4, "ahead", "medium"),  # now group "other"
        ("stop sign", 0.06, "ahead", "low"),
        ("traffic light", 0.06, "ahead", "low"),
        ("parking meter", 0.06, "ahead", "low"),
        ("dog", 0.15, "ahead", "high"),
        ("dog", 0.05, "ahead", "medium"),
        ("cup", 0.3, "ahead", "medium"),
        ("cup", 0.29, "ahead", "low"),
        ("cup", 0.9, "left", "medium"),
        ("cup", 0.5, "ahead", "high"),
        ("cup", 0.4999, "ahead", "medium"),
    ],
)
def test_risk_table_boundaries(label, area, pos, expected):
    assert classify_risk(label, area, pos) == expected


def test_risk_thresholds_are_named_constants():
    assert d.RISK_THRESHOLDS["vehicle"] == (0.03, 0.10, 0.25)
    assert d.RISK_THRESHOLDS["person"][2] == 0.20


# ---------- announcements ----------


def test_person_ahead_exact_string():
    assert announcement(det("person", x=0.4, w=0.2, h=0.1)) == "Person detected ahead."


def test_object_on_left_names_the_object():
    assert announcement(det("chair", x=0.05, w=0.1, h=0.2)) == "Chair detected on your left."
    assert announcement(det("fire hydrant", x=0.8, w=0.1, h=0.2)) == "Fire hydrant detected on your right."


def test_vehicle_ahead_high_is_never_approaching():
    car = det("car", x=0.3, y=0.2, w=0.4, h=0.5)  # area .2 -> high, centre .5
    assert car.risk == "high" and car.announcement == "Vehicle ahead."
    crit = det("bus", x=0.2, y=0.1, w=0.6, h=0.8)
    assert crit.risk == "critical" and crit.announcement == "Vehicle ahead."


def test_vehicle_on_the_side():
    assert det("bus", x=0.0, w=0.3, h=0.7).announcement == "Vehicle on your left."
    assert det("truck", x=0.72, w=0.28, h=0.7).announcement == "Vehicle on your right."


def test_vehicle_low_or_medium_ahead_is_named():
    assert det("car", x=0.4, w=0.1, h=0.1).announcement == "Car detected ahead."


def test_backend_never_says_approaching():
    for label in d.VEHICLES:
        for x in (0.0, 0.4, 0.75):
            assert "approaching" not in det(label, x=x, w=0.25, h=0.9).announcement


def test_summarise_empty_is_exact_and_never_says_safe():
    assert summarise([]) == "Path appears clear in the current camera view."
    assert CLEAR_TEXT == summarise([])
    assert "safe" not in CLEAR_TEXT.lower()


def test_summarise_only_low_risk_is_not_clear():
    chair = det("chair", x=0.05, w=0.1, h=0.2)
    assert chair.risk == "low"
    text = summarise([chair])
    assert text == "Objects detected in view, none close."
    assert text != CLEAR_TEXT and "clear" not in text.lower()


def test_summarise_speaks_only_medium_or_higher():
    low = det("person", x=0.4, w=0.05, h=0.1)  # area .005 -> low
    med = det("car", x=0.4, w=0.2, h=0.2)  # .04 -> medium
    assert (low.risk, med.risk) == ("low", "medium")
    assert summarise([low, med]) == "Car detected ahead."


def test_summarise_prioritises_highest_risk():
    chair = det("chair", x=0.4, w=0.1, h=0.1)
    car = det("car", x=0.3, y=0.2, w=0.4, h=0.5)
    assert summarise([chair, car]) == "Vehicle ahead."
    assert d.highest_risk([chair, car]) == "high"
    assert d.highest_risk([]) is None


def test_summarise_tie_prefers_larger_box():
    small = det("chair", x=0.05, w=0.1, h=0.2)  # left, low
    large = det("chair", x=0.0, w=0.3, h=1.0)  # left, high demoted to medium (area .3)
    assert large.risk == "medium"
    assert d.top_detection([small, large]) is large
    same_risk_small = det("person", x=0.4, w=0.1, h=0.25)  # ahead, area .025 medium
    same_risk_large = det("person", x=0.3, w=0.2, h=0.2)  # ahead, area .04 medium
    assert same_risk_small.risk == same_risk_large.risk == "medium"
    assert d.top_detection([same_risk_small, same_risk_large]) is same_risk_large


# ---------- Detector validation ----------


def png(size=(32, 32)):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, "PNG")
    return buf.getvalue()


class FakeSession:
    """Stands in for onnxruntime.InferenceSession; records the tensor it was given."""

    def __init__(self, rows=()):
        self.rows = rows
        self.shapes = []

    def run(self, _outputs, feed):
        (tensor,) = feed.values()
        self.shapes.append(tensor.shape)
        return [raw_output(self.rows) if self.rows else np.zeros((1, 84, 8400), np.float32)]


def with_session(rows=()):
    detector = Detector("unused.onnx")
    detector._session = FakeSession(rows)
    detector._input_name = "images"
    return detector


def encode(img, fmt, **kw):
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def test_detector_rejects_non_image_as_unreadable(tmp_path):
    with pytest.raises(InvalidImageError, match="Could not read image"):
        Detector(tmp_path / "m.onnx").detect(b"definitely not an image")


def test_detector_rejects_oversized_bytes(tmp_path):
    with pytest.raises(ImageTooLargeError):
        Detector(tmp_path / "m.onnx").detect(b"0" * (10 * 1024 * 1024 + 1))


def test_pixel_cap_rejects_small_file_with_huge_dimensions():
    bomb = encode(Image.new("L", (6000, 5000)), "PNG")  # 30M px, a few KB on disk
    assert len(bomb) < 1024 * 1024 and 6000 * 5000 > d.MAX_PIXELS
    with pytest.raises(ImageTooLargeError):
        with_session().detect(bomb)


def test_pixel_cap_checked_before_decoding(monkeypatch):
    bomb = encode(Image.new("L", (6000, 5000)), "PNG")
    monkeypatch.setattr(Image.Image, "load", lambda self: pytest.fail("decoded a bomb"))
    with pytest.raises(ImageTooLargeError):
        d._open_image(bomb)


def test_image_at_pixel_cap_is_accepted():
    ok = encode(Image.new("L", (5000, 5000)), "PNG")  # exactly 25M
    assert d._open_image(ok).size == (5000, 5000)


def test_decompression_bomb_warning_becomes_too_large(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    monkeypatch.setattr(d, "MAX_PIXELS", 10**9)
    with pytest.raises(ImageTooLargeError):
        d._open_image(encode(Image.new("L", (100, 100)), "PNG"))


def noise(size=(200, 200)):
    rng = np.random.default_rng(1)
    return Image.fromarray(rng.integers(0, 255, (*size, 3), dtype=np.uint8))


@pytest.mark.parametrize("fmt", ["JPEG", "PNG"])
def test_truncated_image_is_a_client_error(fmt):
    data = encode(noise(), fmt)
    with pytest.raises(InvalidImageError, match="Could not read image"):
        with_session().detect(data[: len(data) // 2])


def test_exif_rotated_image_boxes_use_oriented_image():
    img = Image.new("RGB", (100, 50), "white")  # landscape pixels...
    exif = Image.Exif()
    exif[0x0112] = 6  # ...displayed rotated 90 deg -> 50x100
    data = encode(img, "JPEG", exif=exif)
    # Letterbox of 50x100: scale 6.4, pad (160, 0). Box in letterbox space
    # cx=240 cy=160 w=160 h=320 -> original x 0..25, y 0..50.
    result = with_session([(240, 160, 160, 320, 0, 0.9)]).detect(data, conf=0.5)
    assert (result.width, result.height) == (50, 100)
    (p,) = result.detections
    assert p.box == pytest.approx({"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5})


@pytest.mark.parametrize(
    "img",
    [
        Image.new("RGBA", (40, 30), (255, 0, 0, 128)),
        Image.new("P", (40, 30)),
        Image.new("L", (40, 30), 200),
        Image.new("1", (40, 30)),
        Image.new("CMYK", (40, 30)),
    ],
    ids=["rgba", "palette", "grey", "bilevel", "cmyk"],
)
def test_all_colour_modes_are_normalised_to_rgb(img):
    detector = with_session()
    fmt = "TIFF" if img.mode == "CMYK" else "PNG"
    result = detector.detect(encode(img, fmt))
    assert (result.width, result.height) == (40, 30)
    assert detector._session.shapes == [(1, 3, 640, 640)]


def test_detector_missing_model(tmp_path):
    with pytest.raises(ModelNotFoundError, match="export_model.py"):
        Detector(tmp_path / "missing.onnx").detect(png())


def test_corrupt_model_is_load_error_and_failure_is_cached(tmp_path, monkeypatch):
    model = tmp_path / "bad.onnx"
    model.write_bytes(b"garbage, not an onnx file")
    import onnxruntime as ort

    calls = []
    real = ort.InferenceSession

    def counting(*a, **k):
        calls.append(1)
        return real(*a, **k)

    monkeypatch.setattr(ort, "InferenceSession", counting)
    now = [1000.0]
    monkeypatch.setattr(d.time, "monotonic", lambda: now[0])
    detector = Detector(model)
    with pytest.raises(ModelLoadError, match="could not be loaded"):
        detector.detect(png())
    now[0] += d.LOAD_FAILURE_TTL_S - 1
    with pytest.raises(ModelLoadError):
        detector.detect(png())
    assert len(calls) == 1  # cached, not retried
    now[0] += 2  # past the TTL
    with pytest.raises(ModelLoadError):
        detector.detect(png())
    assert len(calls) == 2


# ---------- real-model integration ----------


@pytest.mark.skipif(not d.MODEL_PATH.is_file(), reason="models/yolov8n.onnx absent; run scripts/export_model.py")
def test_real_model_on_bus_image():
    bus = DATA / "bus.jpg"
    result = Detector().detect(bus.read_bytes(), conf=0.4)
    labels = {x.label for x in result.detections}
    assert {"person", "bus"} <= labels
    assert (result.width, result.height) == (810, 1080)
    bus_box = max(
        (x for x in result.detections if x.label == "bus"), key=lambda x: x.box["w"] * x.box["h"]
    ).box
    assert bus_box["w"] > 0.8 and bus_box["x"] < 0.1  # spans most of the width
    assert 0.1 < bus_box["y"] < 0.35 and 0.7 < bus_box["y"] + bus_box["h"] <= 1.0  # lower-middle
    for x in result.detections:
        if x.label == "person":
            assert x.box["x"] + x.box["w"] <= 1.0 + 1e-6 and x.box["y"] + x.box["h"] <= 1.0 + 1e-6
            assert x.box["h"] > 0.2
    assert 0 < result.inference_ms < 5000
    for x in result.detections:
        assert 0 <= x.box["x"] <= 1 and 0 < x.box["w"] <= 1
        assert x.position in ("left", "ahead", "right") and x.risk in d.RISK_LEVELS
        assert x.announcement.endswith(".")


@pytest.mark.skipif(not d.MODEL_PATH.is_file(), reason="models/yolov8n.onnx absent; run scripts/export_model.py")
def test_real_model_blank_image_has_no_detections():
    result = Detector().detect(png((320, 240)), conf=0.5)
    assert result.detections == [] and summarise(result.detections) == CLEAR_TEXT
