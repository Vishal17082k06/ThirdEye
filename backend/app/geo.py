"""Coimbatore service area and small geographic helpers."""

import math

COIMBATORE_BOUNDS = {"south": 10.85, "west": 76.85, "north": 11.15, "east": 77.15}
COIMBATORE_CENTRE = {"lat": 11.0168, "lon": 76.9558}

RESTRICTION_MESSAGE = (
    "Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. "
    "Please choose a place inside the Coimbatore service area."
)

EARTH_RADIUS_M = 6_371_008.8


def in_service_area(lat: float, lon: float) -> bool:
    """True when the point lies inside the Coimbatore box (edges inclusive).

    NaN, infinities and impossible coordinates are never inside.
    """
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    b = COIMBATORE_BOUNDS
    return b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle (straight-line) distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))
