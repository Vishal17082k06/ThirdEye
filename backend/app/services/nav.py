"""Navigation providers: Nominatim (geocoding) and OSM-hosted OSRM (routing).

All network access goes through an injected httpx.AsyncClient so tests can fake it.
"""

import asyncio
import time
from typing import Any

import httpx

from app.config import settings
from app.geo import COIMBATORE_BOUNDS, in_service_area

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OSRM_BASE = "https://routing.openstreetmap.de"
ROUTE_PROVIDER = "OSRM (routing.openstreetmap.de)"
GEOCODE_TIMEOUT_S = 8.0
ROUTE_TIMEOUT_S = 10.0
CACHE_TTL_S = 600
CACHE_MAX = 256
MIN_INTERVAL_S = 1.0  # Nominatim usage policy: at most one request per second
NO_PLACES_NOTE = "No matching places inside Coimbatore"
BIKE_UNAVAILABLE = "Bicycle routing is not available for this trip"
OSRM_PATHS = {"foot": "routed-foot", "car": "routed-car", "bike": "routed-bike"}


class ProviderError(Exception):
    """The upstream service failed, timed out or returned something unusable."""


class NoRouteError(Exception):
    """The provider answered but found no route."""


# ---- cache + rate limit (process-local state) ----

_cache: dict[str, tuple[float, Any]] = {}
_lock = asyncio.Lock()
_last_call = 0.0


def reset_state() -> None:
    global _last_call
    _cache.clear()
    _last_call = 0.0


def _cache_get(key: str) -> Any | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    if time.monotonic() - hit[0] > CACHE_TTL_S:
        del _cache[key]
        return None
    return hit[1]


def _cache_put(key: str, value: Any) -> None:
    _cache[key] = (time.monotonic(), value)
    while len(_cache) > CACHE_MAX:
        del _cache[next(iter(_cache))]  # oldest insertion first


def _headers() -> dict[str, str]:
    return {"User-Agent": settings.nominatim_user_agent, "Accept-Language": "en"}


async def _nominatim_get(client: httpx.AsyncClient, path: str, params: dict[str, Any]) -> Any:
    global _last_call
    async with _lock:
        wait = _last_call + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            resp = await client.get(
                f"{NOMINATIM_URL}{path}", params=params, headers=_headers(), timeout=GEOCODE_TIMEOUT_S
            )
        except httpx.HTTPError as exc:
            raise ProviderError("The place search service is unavailable right now.") from exc
        finally:
            _last_call = time.monotonic()
    if resp.status_code != 200:
        raise ProviderError("The place search service is unavailable right now.")
    try:
        return resp.json()
    except ValueError as exc:
        raise ProviderError("The place search service returned an invalid response.") from exc


async def search_places(client: httpx.AsyncClient, q: str) -> dict[str, Any]:
    key = "s:" + " ".join(q.lower().split())
    cached = _cache_get(key)
    if cached is not None:
        return cached
    data = await _nominatim_get(
        client,
        "/search",
        {
            "q": q,
            "format": "jsonv2",
            "limit": 8,
            "viewbox": "{west},{north},{east},{south}".format(**COIMBATORE_BOUNDS),
            "bounded": 1,
            "countrycodes": "in",
            "addressdetails": 0,
        },
    )
    if not isinstance(data, list):
        raise ProviderError("The place search service returned an invalid response.")
    results = []
    for item in data:
        try:
            lat, lon = float(item["lat"]), float(item["lon"])
            label = str(item["display_name"])
        except (KeyError, TypeError, ValueError):
            continue
        if not in_service_area(lat, lon):
            continue
        results.append({"label": label, "lat": lat, "lon": lon, "kind": str(item.get("type") or "place")})
    out = {"results": results, "note": None if results else NO_PLACES_NOTE}
    _cache_put(key, out)
    return out


async def reverse_place(client: httpx.AsyncClient, lat: float, lon: float) -> str | None:
    key = f"r:{lat:.5f},{lon:.5f}"
    cached = _cache_get(key)
    if cached is not None:
        return cached or None
    data = await _nominatim_get(
        client, "/reverse", {"lat": lat, "lon": lon, "format": "jsonv2", "addressdetails": 0}
    )
    if not isinstance(data, dict):
        raise ProviderError("The place search service returned an invalid response.")
    label = data.get("display_name")
    label = label if isinstance(label, str) and label else ""
    _cache_put(key, label)
    return label or None


# ---- routing ----


def _onto(name: str | None, word: str = "onto") -> str:
    return f" {word} {name}" if name else ""


def build_instruction(
    type_: str | None, modifier: str | None, name: str | None, exit_number: int | None = None
) -> str:
    """Human-readable English instruction for one OSRM maneuver (pure function)."""
    t = (type_ or "").lower()
    m = (modifier or "").lower() or None
    name = (name or "").strip() or None
    if t == "depart":
        head = f"Head {m}" if m else "Head out"
        return head + _onto(name, "on")
    if t == "arrive":
        side = f", on the {m}" if m in ("left", "right") else ""
        return "You have arrived at your destination" + side
    if t == "turn":
        if m == "uturn":
            return "Make a U-turn" + _onto(name)
        if m == "straight":
            return "Continue straight" + _onto(name)
        return ("Turn " + m if m else "Turn") + _onto(name)
    if t == "continue":
        return ("Continue " + m if m else "Continue") + _onto(name, "on")
    if t == "new name":
        return ("Continue " + m if m else "Continue") + _onto(name)
    if t in ("roundabout", "rotary", "roundabout turn"):
        base = f"At the roundabout, take exit {exit_number}" if exit_number else "At the roundabout, continue"
        return base + _onto(name)
    if t in ("exit roundabout", "exit rotary"):
        return "Exit the roundabout" + _onto(name)
    if t == "merge":
        return ("Merge " + m if m else "Merge") + _onto(name)
    if t == "fork":
        return (f"Keep {m} at the fork" if m else "Keep to the fork") + _onto(name)
    if t == "end of road":
        return ("At the end of the road, turn " + m if m else "At the end of the road, turn") + _onto(name)
    if t == "on ramp":
        return ("Take the ramp on the " + m if m in ("left", "right") else "Take the ramp") + _onto(name)
    if t == "off ramp":
        return ("Take the exit on the " + m if m in ("left", "right") else "Take the exit") + _onto(name)
    return "Continue" + _onto(name, "on")


def _num(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProviderError("The routing service returned an invalid response.")
    return value


def _parse_route(data: Any, mode: str) -> dict[str, Any]:
    bad = ProviderError("The routing service returned an invalid response.")
    if not isinstance(data, dict):
        raise bad
    code = data.get("code")
    if code == "NoRoute":
        raise NoRouteError()
    if code != "Ok" or not isinstance(data.get("routes"), list) or not data["routes"]:
        raise bad
    try:
        route = data["routes"][0]
        geometry = route["geometry"]
        coords = geometry["coordinates"]
        if geometry.get("type") != "LineString" or not isinstance(coords, list):
            raise bad
        steps = []
        for leg in route.get("legs", []):
            for s in leg.get("steps", []):
                man = s["maneuver"]
                lon, lat = man["location"]
                name = s.get("name") or ""
                steps.append(
                    {
                        "instruction": build_instruction(
                            man.get("type"), man.get("modifier"), name, man.get("exit")
                        ),
                        "distance_m": _num(s["distance"]),
                        "duration_s": _num(s["duration"]),
                        "maneuver": {
                            "type": man.get("type"),
                            "modifier": man.get("modifier"),
                            "lat": float(lat),
                            "lon": float(lon),
                        },
                        "name": name,
                    }
                )
        return {
            "mode": mode,
            "distance_m": _num(route["distance"]),
            "duration_s": _num(route["duration"]),
            "geometry": {"type": "LineString", "coordinates": coords},
            "steps": steps,
            "provider": ROUTE_PROVIDER,
        }
    except ProviderError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise bad from exc


async def fetch_route(
    client: httpx.AsyncClient, mode: str, from_lat: float, from_lon: float, to_lat: float, to_lon: float
) -> dict[str, Any]:
    url = f"{OSRM_BASE}/{OSRM_PATHS[mode]}/route/v1/driving/{from_lon},{from_lat};{to_lon},{to_lat}"
    try:
        resp = await client.get(
            url,
            params={"overview": "full", "geometries": "geojson", "steps": "true"},
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=ROUTE_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        raise ProviderError("The routing service is unavailable right now.") from exc
    if resp.status_code == 400:
        try:
            body = resp.json()
        except ValueError:
            body = None
        if isinstance(body, dict) and body.get("code") == "NoRoute":
            raise NoRouteError()
    if resp.status_code != 200:
        raise ProviderError("The routing service is unavailable right now.")
    try:
        data = resp.json()
    except ValueError as exc:
        raise ProviderError("The routing service returned an invalid response.") from exc
    return _parse_route(data, mode)
