"""YOLOv8n (ONNX) obstacle detector: pure helpers plus a lazy ONNX Runtime wrapper.

Pipeline
--------
1. ``letterbox``  - resize keeping aspect ratio, pad to a 640x640 square (grey 114).
2. ONNX Runtime (CPU) -> output of shape [1, 84, 8400]: for each of 8400 candidate
   boxes, 4 numbers (centre x, centre y, width, height in letterbox pixels) and 80
   COCO class scores.
3. ``decode`` - confidence filter, xywh -> xyxy, per-class NMS (IoU 0.45), then map
   the boxes back to the original image and normalise to 0..1.
4. ``position_of`` / ``classify_risk`` / ``announcement`` / ``summarise``.

Position: a box is ``ahead`` when its centre is in the central band x 0.33-0.67 OR it
covers more than 25% of that band (a big object spilling over from the side still
blocks the path); otherwise ``left`` / ``right`` by its centre.

Risk table (``area`` = normalised box width * height, i.e. fraction of the frame;
a bigger box means the object is closer). Thresholds are inclusive lower bounds and
are the named constants in ``RISK_THRESHOLDS``. Objects NOT ahead are demoted one level.

    group    classes                                   medium  high   critical
    -------  ----------------------------------------  ------  -----  --------
    vehicle  car bus truck motorcycle bicycle train    0.03    0.10   0.25
    person   person                                    0.02    0.08   0.20
    animal   dog cat horse cow sheep bird ...          0.05    0.15   never
    static   bench chair couch potted plant hydrant..  0.05    0.30   never
    other    everything else (signs, lights, cups...)  0.30    0.50   never

Below ``medium`` the risk is ``low``. Only vehicles and people can be ``critical``.
Static and other objects are capped at ``medium`` unless they are ahead AND very large
(the ``high`` column); off-axis they are demoted from there. Risk is a heuristic from a
single camera frame: it is NOT a distance measurement.

Announcements are stateless, so the backend never claims a vehicle is "approaching"
(that needs consecutive frames; the frontend derives it from a growing box). A
vehicle ahead at high/critical risk is "Vehicle ahead."; off-axis it is
"Vehicle on your left/right."; other objects are "<Label> detected ahead|on your left.".
The frame summary speaks only detections of risk >= medium; if there are detections
but none that close it says "Objects detected in view, none close."; only a frame with
zero detections says "Path appears clear in the current camera view." (never "safe").

Optional OpenAI Vision: NOT implemented. The ``ai.openaiVisionEnabled`` setting is a
documented no-op; the YOLO result is always the primary (and only) engine.
"""

from __future__ import annotations

import io
import threading
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "yolov8n.onnx"
MODEL_NAME = "yolov8n-onnx"
INPUT_SIZE = 640
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 25_000_000  # decompression-bomb guard, checked before decoding
LOAD_FAILURE_TTL_S = 30.0
MAX_DETECTIONS = 100
IOU_THRESHOLD = 0.45
PAD_VALUE = 114

# Position boundaries on the normalised centre x.
LEFT_MAX = 0.33  # centre x < LEFT_MAX -> left
RIGHT_MIN = 0.67  # centre x > RIGHT_MIN -> right
BAND_OVERLAP_MIN = 0.25  # fraction of the central band a box must cover to count as ahead

RISK_LEVELS = ("low", "medium", "high", "critical")

# (medium, high, critical) minimum normalised box areas per group. None = unreachable.
RISK_THRESHOLDS: dict[str, tuple[float, float | None, float | None]] = {
    "vehicle": (0.03, 0.10, 0.25),
    "person": (0.02, 0.08, 0.20),
    "animal": (0.05, 0.15, None),
    "static": (0.05, 0.30, None),
    "other": (0.30, 0.50, None),
}

COCO_CLASSES: tuple[str, ...] = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush",
)

VEHICLES = frozenset({"car", "bus", "truck", "motorcycle", "bicycle", "train"})
ANIMALS = frozenset(
    {"bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"}
)
STATIC_OBSTACLES = frozenset(
    {
        "bench", "chair", "couch", "potted plant", "dining table", "fire hydrant",
        "suitcase", "bed",
    }
)

CLEAR_TEXT = "Path appears clear in the current camera view."
NONE_CLOSE_TEXT = "Objects detected in view, none close."
LOAD_ERROR_TEXT = "Detection model could not be loaded. Re-run backend/scripts/export_model.py"
SPOKEN_MIN_RISK = "medium"


class DetectorError(Exception):
    """Base class for detector failures."""


class ModelNotFoundError(DetectorError):
    pass


class ModelLoadError(DetectorError):
    """The model file exists but ONNX Runtime could not load it."""


class InvalidImageError(DetectorError):
    pass


class ImageTooLargeError(DetectorError):
    pass


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    box: dict[str, float]  # normalised x, y (top-left), w, h in 0..1
    position: str
    risk: str
    announcement: str


@dataclass
class DetectionResult:
    detections: list[Detection]
    width: int
    height: int
    inference_ms: float = 0.0


# ---------------------------------------------------------------- pure helpers


def letterbox(
    img: np.ndarray | Image.Image, size: int = INPUT_SIZE
) -> tuple[np.ndarray, float, tuple[int, int]]:
    """Resize keeping aspect ratio and pad to size x size.

    Returns (HxWx3 uint8 array, scale, (pad_x, pad_y)) where pad is the left/top
    padding in pixels. An original coordinate maps to ``x * scale + pad_x``.
    """
    pil = img if isinstance(img, Image.Image) else Image.fromarray(np.asarray(img))
    w, h = pil.size
    scale = min(size / w, size / h)
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    resized = pil.convert("RGB").resize((new_w, new_h), Image.BILINEAR)
    canvas = np.full((size, size, 3), PAD_VALUE, dtype=np.uint8)
    pad_x, pad_y = (size - new_w) // 2, (size - new_h) // 2
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = np.asarray(resized)
    return canvas, scale, (pad_x, pad_y)


def xywh_to_xyxy(boxes: np.ndarray) -> np.ndarray:
    out = np.empty_like(boxes, dtype=np.float32)
    out[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
    out[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
    out[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
    out[:, 3] = boxes[:, 1] + boxes[:, 3] / 2
    return out


def nms(
    boxes: np.ndarray,
    scores: np.ndarray,
    classes: np.ndarray,
    iou_threshold: float = IOU_THRESHOLD,
) -> list[int]:
    """Per-class non-maximum suppression on xyxy boxes. Returns kept indices,
    highest score first. Boxes of different classes never suppress each other."""
    keep: list[int] = []
    for cls in np.unique(classes):
        idx = np.where(classes == cls)[0]
        idx = idx[np.argsort(-scores[idx])]
        while idx.size:
            i = int(idx[0])
            keep.append(i)
            rest = idx[1:]
            if rest.size == 0:
                break
            xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
            yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
            xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
            yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
            inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
            area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
            area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
            iou = inter / np.maximum(area_i + area_r - inter, 1e-9)
            idx = rest[iou <= iou_threshold]
    keep.sort(key=lambda k: -scores[k])
    return keep


def position_of(center_x: float, width: float = 0.0) -> str:
    """left / ahead / right from the normalised box centre and width."""
    if LEFT_MAX <= center_x <= RIGHT_MIN:
        return "ahead"
    overlap = min(center_x + width / 2, RIGHT_MIN) - max(center_x - width / 2, LEFT_MAX)
    if overlap > BAND_OVERLAP_MIN * (RIGHT_MIN - LEFT_MAX):
        return "ahead"
    return "left" if center_x < LEFT_MAX else "right"


def risk_group(label: str) -> str:
    if label == "person":
        return "person"
    if label in VEHICLES:
        return "vehicle"
    if label in ANIMALS:
        return "animal"
    if label in STATIC_OBSTACLES:
        return "static"
    return "other"


def classify_risk(label: str, area: float, position: str) -> str:
    """Risk from class group, normalised box area and position (see module table)."""
    medium, high, critical = RISK_THRESHOLDS[risk_group(label)]
    level = 0
    if critical is not None and area >= critical:
        level = 3
    elif high is not None and area >= high:
        level = 2
    elif area >= medium:
        level = 1
    if position != "ahead":
        level = max(0, level - 1)
    return RISK_LEVELS[level]


def announcement(detection: Detection) -> str:
    if detection.label in VEHICLES:
        if detection.position != "ahead":
            return f"Vehicle on your {detection.position}."
        if detection.risk in ("high", "critical"):
            return "Vehicle ahead."
    name = detection.label[:1].upper() + detection.label[1:]
    where = "ahead" if detection.position == "ahead" else f"on your {detection.position}"
    return f"{name} detected {where}."


def make_detection(label: str, confidence: float, box: dict[str, float]) -> Detection:
    """Build a Detection, deriving position, risk and announcement from the box."""
    position = position_of(box["x"] + box["w"] / 2, box["w"])
    risk = classify_risk(label, box["w"] * box["h"], position)
    partial = Detection(label, confidence, box, position, risk, "")
    return Detection(label, confidence, box, position, risk, announcement(partial))


def top_detection(detections: list[Detection]) -> Detection | None:
    """Highest risk first; ties broken by larger box, then confidence."""
    if not detections:
        return None
    return max(
        detections,
        key=lambda d: (RISK_LEVELS.index(d.risk), d.box["w"] * d.box["h"], d.confidence),
    )


def highest_risk(detections: list[Detection]) -> str | None:
    top = top_detection(detections)
    return top.risk if top else None


def summarise(detections: list[Detection]) -> str:
    """One announcement for the whole frame, driven by the highest-risk detection."""
    top = top_detection(detections)
    if top is None:
        return CLEAR_TEXT
    if RISK_LEVELS.index(top.risk) < RISK_LEVELS.index(SPOKEN_MIN_RISK):
        return NONE_CLOSE_TEXT
    return top.announcement


def decode(
    output: np.ndarray,
    conf: float,
    scale: float,
    pad: tuple[int, int],
    orig_size: tuple[int, int],
    iou_threshold: float = IOU_THRESHOLD,
) -> list[Detection]:
    """Turn raw YOLOv8 output [1, 84, N] into Detections in original-image terms."""
    preds = np.asarray(output)[0].T  # (N, 84)
    class_scores = preds[:, 4:]
    classes = class_scores.argmax(axis=1)
    scores = class_scores[np.arange(len(classes)), classes]
    mask = scores >= conf
    if not mask.any():
        return []
    xyxy = xywh_to_xyxy(preds[mask, :4])
    scores, classes = scores[mask], classes[mask]
    keep = nms(xyxy, scores, classes, iou_threshold)[:MAX_DETECTIONS]

    width, height = orig_size
    pad_x, pad_y = pad
    results: list[Detection] = []
    for i in keep:
        x1 = float(np.clip((xyxy[i, 0] - pad_x) / scale, 0, width))
        y1 = float(np.clip((xyxy[i, 1] - pad_y) / scale, 0, height))
        x2 = float(np.clip((xyxy[i, 2] - pad_x) / scale, 0, width))
        y2 = float(np.clip((xyxy[i, 3] - pad_y) / scale, 0, height))
        if x2 <= x1 or y2 <= y1:
            continue
        box = {"x": x1 / width, "y": y1 / height, "w": (x2 - x1) / width, "h": (y2 - y1) / height}
        results.append(make_detection(COCO_CLASSES[int(classes[i])], float(scores[i]), box))
    return results


# ------------------------------------------------------------------- the model


def _open_image(image_bytes: bytes) -> Image.Image:
    """Decode to an upright RGB image, mapping every failure to a DetectorError."""
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError("Image is larger than the 10 MB limit")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(image_bytes))
            if img.width * img.height > MAX_PIXELS:  # header only: nothing decoded yet
                raise ImageTooLargeError("Image has too many pixels (limit 25 megapixels)")
            img.load()
            return ImageOps.exif_transpose(img).convert("RGB")
    except ImageTooLargeError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageTooLargeError("Image has too many pixels (limit 25 megapixels)") from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise InvalidImageError("Could not read image") from None


class Detector:
    """Lazy, thread-safe wrapper around one ONNX Runtime CPU session."""

    def __init__(self, model_path: Path = MODEL_PATH) -> None:
        self.model_path = Path(model_path)
        self._session: Any = None
        self._input_name = ""
        self._failed_at: float | None = None
        self._lock = threading.Lock()

    def _load_failed_recently(self) -> bool:
        return (
            self._failed_at is not None
            and time.monotonic() - self._failed_at < LOAD_FAILURE_TTL_S
        )

    def _get_session(self) -> Any:
        if self._session is None:
            with self._lock:
                if self._session is None:
                    if not self.model_path.is_file():
                        raise ModelNotFoundError(
                            "Detection model not found. Run backend/scripts/export_model.py"
                        )
                    if self._load_failed_recently():
                        raise ModelLoadError(LOAD_ERROR_TEXT)
                    try:
                        import onnxruntime as ort

                        session = ort.InferenceSession(
                            str(self.model_path), providers=["CPUExecutionProvider"]
                        )
                        self._input_name = session.get_inputs()[0].name
                    except Exception:  # corrupt/incompatible model: do not retry per request
                        self._failed_at = time.monotonic()
                        raise ModelLoadError(LOAD_ERROR_TEXT) from None
                    self._failed_at = None
                    self._session = session
        return self._session

    def detect(self, image_bytes: bytes, conf: float = 0.5) -> DetectionResult:
        img = _open_image(image_bytes)
        session = self._get_session()
        start = time.perf_counter()
        canvas, scale, pad = letterbox(img, INPUT_SIZE)
        tensor = (canvas.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        output = session.run(None, {self._input_name: np.ascontiguousarray(tensor)})[0]
        detections = decode(output, conf, scale, pad, img.size)
        elapsed = (time.perf_counter() - start) * 1000
        return DetectionResult(detections, img.width, img.height, round(elapsed, 1))


_detector = Detector()


def get_detector() -> Detector:
    """FastAPI dependency returning the process-wide detector."""
    return _detector
