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
        ("chair", 0.20, "ahead", "high"),
        ("chair", 0.05, "ahead", "medium"),
        ("chair", 0.0499, "ahead", "low"),
        ("chair", 0.20, "right", "medium"),
        ("fire hydrant", 0.9, "ahead", "high"),  # static obstacles never critical
        ("dog", 0.15, "ahead", "high"),
        ("dog", 0.05, "ahead", "medium"),
        ("cup", 0.3, "ahead", "medium"),
        ("cup", 0.29, "ahead", "low"),
        ("cup", 0.9, "left", "low"),
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


def test_vehicle_ahead_high_is_approaching():
    car = det("car", x=0.3, y=0.2, w=0.4, h=0.5)  # area .2 -> high, centre .5
    assert car.risk == "high" and car.announcement == "Vehicle approaching."


def test_vehicle_low_risk_or_side_is_named():
    assert det("car", x=0.4, w=0.1, h=0.1).announcement == "Car detected ahead."
    assert det("bus", x=0.0, w=0.4, h=0.7).announcement == "Bus detected on your left."


def test_summarise_empty_is_exact_and_never_says_safe():
    assert summarise([]) == "Path appears clear in the current camera view."
    assert CLEAR_TEXT == summarise([])
    assert "safe" not in CLEAR_TEXT.lower()


def test_summarise_prioritises_highest_risk():
    chair = det("chair", x=0.4, w=0.1, h=0.1)
    car = det("car", x=0.3, y=0.2, w=0.4, h=0.5)
    assert summarise([chair, car]) == "Vehicle approaching."
    assert d.highest_risk([chair, car]) == "high"
    assert d.highest_risk([]) is None


def test_summarise_tie_prefers_larger_box():
    small = det("chair", x=0.05, w=0.1, h=0.2)  # left, low
    large = det("chair", x=0.0, w=0.3, h=0.9)  # left, high demoted to medium (area .27)
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


def test_detector_rejects_non_image(tmp_path):
    with pytest.raises(InvalidImageError):
        Detector(tmp_path / "m.onnx").detect(b"definitely not an image")


def test_detector_rejects_oversized(tmp_path):
    with pytest.raises(ImageTooLargeError):
        Detector(tmp_path / "m.onnx").detect(b"0" * (10 * 1024 * 1024 + 1))


def test_detector_missing_model(tmp_path):
    with pytest.raises(ModelNotFoundError, match="export_model.py"):
        Detector(tmp_path / "missing.onnx").detect(png())


# ---------- real-model integration ----------


@pytest.mark.skipif(not d.MODEL_PATH.is_file(), reason="models/yolov8n.onnx absent; run scripts/export_model.py")
def test_real_model_on_bus_image():
    bus = DATA / "bus.jpg"
    result = Detector().detect(bus.read_bytes(), conf=0.4)
    labels = {x.label for x in result.detections}
    assert {"person", "bus"} <= labels
    assert (result.width, result.height) == (810, 1080)
    assert 0 < result.inference_ms < 5000
    for x in result.detections:
        assert 0 <= x.box["x"] <= 1 and 0 < x.box["w"] <= 1
        assert x.position in ("left", "ahead", "right") and x.risk in d.RISK_LEVELS
        assert x.announcement.endswith(".")


@pytest.mark.skipif(not d.MODEL_PATH.is_file(), reason="models/yolov8n.onnx absent; run scripts/export_model.py")
def test_real_model_blank_image_has_no_detections():
    result = Detector().detect(png((320, 240)), conf=0.5)
    assert result.detections == [] and summarise(result.detections) == CLEAR_TEXT
