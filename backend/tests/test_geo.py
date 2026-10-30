import math

import pytest

from app.geo import (
    COIMBATORE_BOUNDS,
    RESTRICTION_MESSAGE,
    haversine_m,
    in_service_area,
)


def test_message_text():
    assert RESTRICTION_MESSAGE == (
        "Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. "
        "Please choose a place inside the Coimbatore service area."
    )


def test_bounds_values():
    assert COIMBATORE_BOUNDS == {"south": 10.85, "west": 76.85, "north": 11.15, "east": 77.15}


@pytest.mark.parametrize(
    "lat,lon",
    [(11.0168, 76.9558), (10.85, 76.85), (11.15, 77.15), (10.85, 77.15), (11.15, 76.85)],
)
def test_inside_inclusive(lat, lon):
    assert in_service_area(lat, lon)


@pytest.mark.parametrize(
    "lat,lon",
    [(10.8499, 76.9), (11.1501, 76.9), (11.0, 76.8499), (11.0, 77.1501), (13.08, 80.27)],
)
def test_outside(lat, lon):
    assert not in_service_area(lat, lon)


@pytest.mark.parametrize(
    "lat,lon",
    [(math.nan, 76.9), (11.0, math.nan), (math.inf, 76.9), (11.0, -math.inf), (91, 76.9), (11.0, 181)],
)
def test_invalid_rejected(lat, lon):
    assert not in_service_area(lat, lon)


def test_haversine():
    assert haversine_m(11.0, 76.9, 11.0, 76.9) == 0
    # one degree of latitude is ~111.19 km
    assert haversine_m(11.0, 76.9, 12.0, 76.9) == pytest.approx(111_195, rel=1e-3)
    assert haversine_m(11.0, 76.9, 11.01, 76.92) == haversine_m(11.01, 76.92, 11.0, 76.9)
