from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Device, User, utcnow
from app.schemas import (
    DeviceConfigUpdate,
    DeviceHeartbeat,
    DeviceList,
    DeviceOut,
    DeviceReport,
)
from app.security import get_current_user
from app.services.events import record_event

router = APIRouter(prefix="/devices", tags=["devices"])

# (key, display name, initial status), in display order.
SEED_DEVICES = (
    ("laptop_camera", "Laptop/USB Camera", "unknown"),  # only the browser can know
    ("esp32_cam", "ESP32-CAM", "not_integrated"),
    ("vl53l0x", "VL53L0X Distance Sensor", "disconnected"),
    ("vibration_motor", "Vibration Motor", "not_integrated"),
    ("battery", "Battery Monitoring", "not_integrated"),
)
BROWSER_REPORTED = "laptop_camera"
HEARTBEAT_DEVICES = ("esp32_cam", "vl53l0x")


def _ensure_seeded(db: Session, user: User) -> list[Device]:
    """Create the user's device rows on first use and return them in display order."""
    rows = {d.key: d for d in db.scalars(select(Device).where(Device.user_id == user.id))}
    if len(rows) < len(SEED_DEVICES):
        for key, name, initial in SEED_DEVICES:
            if key not in rows:
                rows[key] = Device(user_id=user.id, key=key, name=name, status=initial, config={})
                db.add(rows[key])
        try:
            db.commit()
        except IntegrityError:  # a concurrent request seeded first; use its rows
            db.rollback()
            return _ensure_seeded(db, user)
    return [rows[key] for key, _, _ in SEED_DEVICES]


def _get_device(db: Session, user: User, key: str) -> Device:
    for device in _ensure_seeded(db, user):
        if device.key == key:
            return device
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown device")


def _set_status(
    db: Session,
    user: User,
    device: Device,
    new_status: str,
    source: str,
    error: str | None = None,
) -> None:
    """Update status/last_seen/error; log an event (and notify on loss) only on a change."""
    previous = device.status
    device.status = new_status
    device.error = error if new_status == "error" else None
    device.last_seen = utcnow()
    if new_status == previous:
        db.commit()
        return
    lost = new_status in ("disconnected", "error")
    notify = None
    if lost:
        notify = {
            "kind": "device",
            "title": f"{device.name} {new_status.replace('_', ' ')}",
            "body": error or f"{device.name} is {new_status}.",
        }
    db.add(device)  # record_event commits this together with the event
    record_event(
        db,
        user.id,
        "device",
        f"{device.name} {new_status.replace('_', ' ')}",
        source=source,
        details={"device": device.key, "from": previous, "to": new_status, "error": error},
        status="error" if new_status == "error" else "ok",
        notify=notify,
    )


@router.get("", response_model=DeviceList)
def list_devices(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DeviceList:
    return DeviceList(items=[DeviceOut.model_validate(d) for d in _ensure_seeded(db, user)])


@router.put("/{key}", response_model=DeviceOut)
def update_device_config(
    key: str,
    payload: DeviceConfigUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Device:
    """Edit configuration only (merged into the stored config); status is never touched."""
    device = _get_device(db, user, key)
    device.config = {**device.config, **payload.config}
    db.commit()
    return device


@router.post("/{key}/report", response_model=DeviceOut)
def report_browser_device(
    key: str,
    payload: DeviceReport,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Device:
    """The browser reports the status of the laptop/USB camera (the only device it can see)."""
    device = _get_device(db, user, key)
    if key != BROWSER_REPORTED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only the laptop camera status can be reported by the browser"
        )
    _set_status(db, user, device, payload.status, "live", payload.error)
    return device


@router.post("/{key}/heartbeat", response_model=DeviceOut)
def hardware_heartbeat(
    key: str,
    payload: DeviceHeartbeat,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Device:
    """The only way hardware becomes 'connected'. Simulation never reaches this path."""
    device = _get_device(db, user, key)
    if key not in HEARTBEAT_DEVICES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This device does not send heartbeats")
    device.config = {**device.config, "lastInfo": payload.info}
    _set_status(db, user, device, "connected", "hardware")
    return device
