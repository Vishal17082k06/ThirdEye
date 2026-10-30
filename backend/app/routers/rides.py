import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.geo import RESTRICTION_MESSAGE, haversine_m, in_service_area
from app.models import Ride, User
from app.schemas import UtcDatetime
from app.security import get_current_user
from app.services.events import record_event

router = APIRouter(prefix="/rides", tags=["rides"])

DISCLAIMER = (
    "This is a Third Eye ride request (demo). "
    "No driver has been assigned and no real ride has been booked."
)
FARE_NOTE = "Estimate using demo rates — not a real fare."
MIN_SEPARATION_M = 50
MIN_DISTANCE_RATIO = 0.9
MAX_DISTANCE_RATIO = 10
# No 0/O/1/I so an ID read aloud or off a screen cannot be confused.
ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class PointIn(BaseModel):
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
    label: Annotated[str, Field(min_length=1, max_length=200)]


class RideCreate(BaseModel):
    pickup: PointIn
    destination: PointIn
    mode: Literal["car", "bike", "walk"]
    distance_m: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    duration_s: Annotated[float, Field(gt=0, allow_inf_nan=False)]


class PointOut(BaseModel):
    lat: float
    lon: float
    label: str


class RideOut(BaseModel):
    id: int
    booking_id: str
    pickup: PointOut
    destination: PointOut
    mode: str
    distance_m: float
    duration_s: float
    fare_estimate: int | None
    fare_note: str | None
    status: str
    created_at: UtcDatetime
    disclaimer: str = DISCLAIMER


class RideList(BaseModel):
    items: list[RideOut]
    total: int
    limit: int
    offset: int


def generate_booking_id() -> str:
    suffix = "".join(secrets.choice(ID_ALPHABET) for _ in range(4))
    return f"TE-{datetime.now(timezone.utc):%Y%m%d}-{suffix}"


def calculate_fare(mode: str, distance_m: float) -> int | None:
    """Demo-rate estimate computed on the server; walking has no fare."""
    per_km = {"car": settings.ride_per_km_car, "bike": settings.ride_per_km_bike}.get(mode)
    if per_km is None:
        return None
    return round(settings.ride_base_fare_inr + per_km * distance_m / 1000)


def to_out(ride: Ride) -> RideOut:
    return RideOut(
        id=ride.id,
        booking_id=ride.booking_id,
        pickup=PointOut(lat=ride.pickup_lat, lon=ride.pickup_lon, label=ride.pickup_label),
        destination=PointOut(
            lat=ride.destination_lat, lon=ride.destination_lon, label=ride.destination_label
        ),
        mode=ride.mode,
        distance_m=ride.distance_m,
        duration_s=ride.duration_s,
        fare_estimate=None if ride.fare_estimate is None else round(ride.fare_estimate),
        fare_note=None if ride.fare_estimate is None else FARE_NOTE,
        status=ride.status,
        created_at=ride.created_at,
    )


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _validate(payload: RideCreate) -> None:
    for name, point in (("Pickup", payload.pickup), ("Destination", payload.destination)):
        if not in_service_area(point.lat, point.lon):
            raise _unprocessable(f"{name} location is outside the service area. {RESTRICTION_MESSAGE}")
    straight = haversine_m(
        payload.pickup.lat, payload.pickup.lon, payload.destination.lat, payload.destination.lon
    )
    if straight < MIN_SEPARATION_M:
        raise _unprocessable("Pickup and destination must be at least 50 metres apart; choose different places.")
    if not (MIN_DISTANCE_RATIO * straight <= payload.distance_m <= MAX_DISTANCE_RATIO * straight):
        raise _unprocessable("distance does not match the route")


@router.post("", response_model=RideOut, status_code=status.HTTP_201_CREATED)
def create_ride(
    payload: RideCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RideOut:
    _validate(payload)
    fare = calculate_fare(payload.mode, payload.distance_m)
    ride = None
    for _ in range(10):  # retry on the (very unlikely) booking-id collision
        ride = Ride(
            user_id=user.id,
            booking_id=generate_booking_id(),
            pickup_lat=payload.pickup.lat,
            pickup_lon=payload.pickup.lon,
            pickup_label=payload.pickup.label,
            destination_lat=payload.destination.lat,
            destination_lon=payload.destination.lon,
            destination_label=payload.destination.label,
            mode=payload.mode,
            distance_m=payload.distance_m,
            duration_s=payload.duration_s,
            fare_estimate=fare,
            status="requested",
        )
        db.add(ride)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            ride = None
    if ride is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not allocate a booking ID; try again")
    record_event(
        db,
        user.id,
        "ride",
        f"Ride requested {ride.booking_id}: {ride.pickup_label} to {ride.destination_label}",
        source="live",
        details={"booking_id": ride.booking_id, "mode": ride.mode, "distance_m": ride.distance_m},
        status="requested",
        notify={
            "kind": "booking",
            "title": f"Ride request {ride.booking_id} created",
            "body": "Demo request only. No driver has been assigned.",
        },
    )
    return to_out(ride)


@router.get("", response_model=RideList)
def list_rides(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RideList:
    total = db.scalar(select(func.count()).select_from(Ride).where(Ride.user_id == user.id)) or 0
    rows = db.scalars(
        select(Ride)
        .where(Ride.user_id == user.id)
        .order_by(Ride.created_at.desc(), Ride.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return RideList(items=[to_out(r) for r in rows], total=total, limit=limit, offset=offset)


def _own_ride(db: Session, user: User, ride_id: int) -> Ride:
    ride = db.scalar(select(Ride).where(Ride.id == ride_id, Ride.user_id == user.id))
    if ride is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ride not found")
    return ride


@router.get("/{ride_id}", response_model=RideOut)
def get_ride(
    ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RideOut:
    return to_out(_own_ride(db, user, ride_id))


@router.post("/{ride_id}/cancel", response_model=RideOut)
def cancel_ride(
    ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RideOut:
    ride = _own_ride(db, user, ride_id)
    # Conditional UPDATE: only one of two racing cancels can win.
    result = db.execute(
        update(Ride).where(Ride.id == ride.id, Ride.status == "requested").values(status="cancelled")
    )
    db.commit()
    if result.rowcount != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a ride request that is still 'requested' can be cancelled")
    db.refresh(ride)
    record_event(
        db,
        user.id,
        "ride",
        f"Ride request {ride.booking_id} cancelled",
        source="live",
        details={"booking_id": ride.booking_id},
        status="cancelled",
        notify={
            "kind": "booking",
            "title": f"Ride request {ride.booking_id} cancelled",
            "body": "You cancelled this demo ride request.",
        },
    )
    return to_out(ride)
