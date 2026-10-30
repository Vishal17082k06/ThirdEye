"""POST /api/detect: run YOLOv8n ONNX on an uploaded frame.

Optional OpenAI Vision is NOT implemented; ``ai.openaiVisionEnabled`` is a
documented no-op and the YOLO result is always the primary engine.
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, UserSettings
from app.schemas import SettingsDoc
from app.security import get_current_user
from app.services import detector as det
from app.services.events import record_event

router = APIRouter(tags=["detect"])

DEFAULT_CONFIDENCE = 0.5


def _user_confidence(db: Session, user: User) -> float:
    row = db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    try:
        return SettingsDoc.model_validate(dict(row.data) if row else {}).ai.confidenceThreshold
    except ValidationError:
        return DEFAULT_CONFIDENCE


@router.post("/detect")
def detect(
    file: Annotated[UploadFile, File()],
    source: Annotated[Literal["live", "simulation"], Form()] = "live",
    conf: Annotated[float | None, Form(ge=0.05, le=0.95)] = None,
    record: Annotated[bool, Form()] = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    detector: det.Detector = Depends(det.get_detector),
) -> dict[str, Any]:
    data = file.file.read(det.MAX_IMAGE_BYTES + 1)
    threshold = conf if conf is not None else _user_confidence(db, user)
    try:
        result = detector.detect(data, conf=threshold)
    except det.ImageTooLargeError as exc:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(exc)) from None
    except det.InvalidImageError as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(exc)) from None
    except det.ModelNotFoundError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None

    detections = result.detections
    text = det.summarise(detections)
    top = det.top_detection(detections)
    highest = top.risk if top else None

    if record:
        elevated = highest in ("medium", "high", "critical")
        urgent = highest in ("high", "critical")
        record_event(
            db,
            user.id,
            "obstacle" if elevated else "ai_analysis",
            text,
            source=source,
            details={
                "count": len(detections),
                "top_label": top.label if top else None,
                "highest_risk": highest,
                "confidence_threshold": threshold,
            },
            notify={"kind": "obstacle", "title": text, "body": f"Risk level: {highest}."}
            if urgent
            else None,
        )

    return {
        "detections": [
            {
                "label": d.label,
                "confidence": round(d.confidence, 4),
                "box": {k: round(v, 5) for k, v in d.box.items()},
                "position": d.position,
                "risk": d.risk,
                "announcement": d.announcement,
            }
            for d in detections
        ],
        "summary": {"text": text, "highest_risk": highest},
        "image": {"width": result.width, "height": result.height},
        "inference_ms": result.inference_ms,
        "source": source,
        "model": det.MODEL_NAME,
    }
