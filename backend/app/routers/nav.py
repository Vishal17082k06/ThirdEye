from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.geo import COIMBATORE_BOUNDS, COIMBATORE_CENTRE, RESTRICTION_MESSAGE, in_service_area
from app.models import User
from app.security import get_current_user
from app.services import nav as nav_service

router = APIRouter(prefix="/nav", tags=["navigation"])

_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Shared outgoing HTTP client; tests override this dependency with a fake."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(follow_redirects=True)
    return _client


Coord = Annotated[float, Query(allow_inf_nan=False)]
Http = Annotated[httpx.AsyncClient, Depends(get_http_client)]


def _outside() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, RESTRICTION_MESSAGE)


@router.get("/bounds")
def bounds(_: User = Depends(get_current_user)) -> dict:
    return {
        "bounds": COIMBATORE_BOUNDS,
        "centre": COIMBATORE_CENTRE,
        "message": RESTRICTION_MESSAGE,
    }


@router.get("/geocode")
async def geocode(
    http: Http,
    q: Annotated[str, Query(min_length=2, max_length=120)],
    _: User = Depends(get_current_user),
) -> dict:
    if len(q.strip()) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Search text is too short")
    try:
        return await nav_service.search_places(http, q.strip())
    except nav_service.ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/reverse")
async def reverse(
    http: Http,
    lat: Coord,
    lon: Coord,
    _: User = Depends(get_current_user),
) -> dict:
    if not in_service_area(lat, lon):
        raise _outside()
    try:
        label = await nav_service.reverse_place(http, lat, lon)
    except nav_service.ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    if label is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No address found for this location")
    return {"label": label}


@router.get("/route")
async def route(
    http: Http,
    from_lat: Coord,
    from_lon: Coord,
    to_lat: Coord,
    to_lon: Coord,
    mode: Literal["foot", "car", "bike"],
    _: User = Depends(get_current_user),
) -> dict:
    if not (in_service_area(from_lat, from_lon) and in_service_area(to_lat, to_lon)):
        raise _outside()
    try:
        return await nav_service.fetch_route(http, mode, from_lat, from_lon, to_lat, to_lon)
    except nav_service.NoRouteError as exc:
        msg = (
            nav_service.BIKE_UNAVAILABLE
            if mode == "bike"
            else "No route could be found between these places"
        )
        raise HTTPException(status.HTTP_404_NOT_FOUND, msg) from exc
    except nav_service.ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
