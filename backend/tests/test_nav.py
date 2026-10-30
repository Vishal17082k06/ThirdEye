import httpx
import pytest

from app.geo import RESTRICTION_MESSAGE
from app.main import app
from app.routers import nav
from app.services import nav as nav_service
from app.services.nav import build_instruction
from tests.test_auth import auth_header, register


@pytest.fixture(autouse=True)
def _reset_nav_state():
    nav_service.reset_state()
    nav_service.MIN_INTERVAL_S = 0
    yield
    nav_service.reset_state()
    nav_service.MIN_INTERVAL_S = 1.0


@pytest.fixture()
def h(client):
    return auth_header(register(client, email="nav@example.com").json()["token"])


def fake(handler):
    """Route outgoing provider calls to `handler(request) -> httpx.Response`."""
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[nav.get_http_client] = lambda: http
    return http


NOMINATIM = [
    {"display_name": "Gandhipuram, Coimbatore", "lat": "11.0183", "lon": "76.9725", "type": "suburb"},
    {"display_name": "Chennai Central", "lat": "13.0827", "lon": "80.2707", "type": "station"},
]


def test_auth_required(client):
    for url in (
        "/api/nav/bounds",
        "/api/nav/geocode?q=ab",
        "/api/nav/reverse?lat=11&lon=77",
        "/api/nav/route?from_lat=11&from_lon=77&to_lat=11.01&to_lon=77&mode=car",
    ):
        assert client.get(url).status_code == 401


def test_bounds(client, h):
    body = client.get("/api/nav/bounds", headers=h).json()
    assert body == {
        "bounds": {"south": 10.85, "west": 76.85, "north": 11.15, "east": 77.15},
        "centre": {"lat": 11.0168, "lon": 76.9558},
        "message": RESTRICTION_MESSAGE,
    }


def test_geocode_params_and_refilter(client, h):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=NOMINATIM)

    fake(handler)
    r = client.get("/api/nav/geocode?q=gandhipuram", headers=h)
    assert r.status_code == 200
    assert r.json() == {
        "results": [{"label": "Gandhipuram, Coimbatore", "lat": 11.0183, "lon": 76.9725, "kind": "suburb"}],
        "note": None,
    }
    p = seen[0].url.params
    assert seen[0].url.host == "nominatim.openstreetmap.org"
    assert p["format"] == "jsonv2" and p["limit"] == "8" and p["bounded"] == "1"
    assert p["viewbox"] == "76.85,11.15,77.15,10.85" and p["countrycodes"] == "in"
    assert p["addressdetails"] == "0" and p["q"] == "gandhipuram"
    assert "ThirdEye" in seen[0].headers["user-agent"]
    assert seen[0].headers["accept-language"] == "en"


def test_geocode_all_filtered_gives_note(client, h):
    fake(lambda req: httpx.Response(200, json=[NOMINATIM[1]]))
    body = client.get("/api/nav/geocode?q=chennai", headers=h).json()
    assert body == {"results": [], "note": "No matching places inside Coimbatore"}


def test_geocode_cache_hit(client, h):
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(200, json=NOMINATIM)

    fake(handler)
    a = client.get("/api/nav/geocode?q=Gandhipuram", headers=h).json()
    b = client.get("/api/nav/geocode?q=gandhipuram%20", headers=h).json()
    assert a == b and len(calls) == 1


def test_geocode_validation(client, h):
    assert client.get("/api/nav/geocode?q=a", headers=h).status_code == 422
    assert client.get("/api/nav/geocode?q=" + "a" * 121, headers=h).status_code == 422
    assert client.get("/api/nav/geocode", headers=h).status_code == 422


def test_geocode_provider_failures_502(client, h):
    for handler in (
        lambda req: httpx.Response(500, text="boom"),
        lambda req: httpx.Response(200, text="not json"),
        lambda req: httpx.Response(200, json={"unexpected": 1}),
    ):
        nav_service.reset_state()
        fake(handler)
        r = client.get("/api/nav/geocode?q=somewhere", headers=h)
        assert r.status_code == 502 and r.json()["detail"]


def test_geocode_timeout_502(client, h):
    def handler(req):
        raise httpx.ConnectTimeout("slow")

    fake(handler)
    r = client.get("/api/nav/geocode?q=somewhere", headers=h)
    assert r.status_code == 502
    assert "unavailable" in r.json()["detail"].lower()


def test_failures_not_cached(client, h):
    state = {"n": 0}

    def handler(req):
        state["n"] += 1
        return httpx.Response(500) if state["n"] == 1 else httpx.Response(200, json=NOMINATIM)

    fake(handler)
    assert client.get("/api/nav/geocode?q=gandhipuram", headers=h).status_code == 502
    assert client.get("/api/nav/geocode?q=gandhipuram", headers=h).status_code == 200


def test_reverse(client, h):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json={"display_name": "RS Puram, Coimbatore"})

    fake(handler)
    r = client.get("/api/nav/reverse?lat=11.01&lon=76.95", headers=h)
    assert r.json() == {"label": "RS Puram, Coimbatore"}
    assert seen[0].url.path == "/reverse"
    client.get("/api/nav/reverse?lat=11.01&lon=76.95", headers=h)
    assert len(seen) == 1


def test_reverse_outside_422(client, h):
    fake(lambda req: httpx.Response(200, json={}))
    r = client.get("/api/nav/reverse?lat=13.08&lon=80.27", headers=h)
    assert r.status_code == 422 and r.json()["detail"] == RESTRICTION_MESSAGE


def test_reverse_no_address_404(client, h):
    fake(lambda req: httpx.Response(200, json={"error": "Unable to geocode"}))
    assert client.get("/api/nav/reverse?lat=11.01&lon=76.95", headers=h).status_code == 404


OSRM = {
    "code": "Ok",
    "routes": [
        {
            "distance": 1200.5,
            "duration": 900.0,
            "geometry": {"type": "LineString", "coordinates": [[76.95, 11.0], [76.96, 11.01]]},
            "legs": [
                {
                    "steps": [
                        {
                            "name": "Avinashi Road",
                            "distance": 700,
                            "duration": 500,
                            "maneuver": {
                                "type": "depart",
                                "modifier": "right",
                                "bearing_before": 0,
                                "bearing_after": 47,
                                "location": [76.95, 11.0],
                            },
                        },
                        {
                            "name": "",
                            "distance": 0,
                            "duration": 0,
                            "maneuver": {"type": "arrive", "location": [76.96, 11.01]},
                        },
                    ]
                }
            ],
        }
    ],
}
ROUTE = "/api/nav/route?from_lat=11.0&from_lon=76.95&to_lat=11.01&to_lon=76.96&mode="


def test_route_ok_per_mode_url(client, h):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=OSRM)

    fake(handler)
    r = client.get(ROUTE + "foot", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "foot" and body["distance_m"] == 1200.5 and body["duration_s"] == 900.0
    assert body["provider"] == "OSRM (routing.openstreetmap.de)"
    assert body["geometry"]["coordinates"][0] == [76.95, 11.0]
    assert body["steps"][0] == {
        "instruction": "Head north-east on Avinashi Road",
        "distance_m": 700,
        "duration_s": 500,
        "maneuver": {"type": "depart", "modifier": "right", "lat": 11.0, "lon": 76.95},
        "name": "Avinashi Road",
    }
    assert body["steps"][1]["instruction"] == "You have arrived at your destination"
    assert body["steps"][1]["name"] == ""
    assert str(seen[0].url).startswith(
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/76.95,11.0;76.96,11.01"
    )
    q = seen[0].url.params
    assert q["overview"] == "full" and q["geometries"] == "geojson" and q["steps"] == "true"
    client.get(ROUTE + "car", headers=h)
    client.get(ROUTE + "bike", headers=h)
    assert [r.url.path.split("/")[1] for r in seen] == ["routed-foot", "routed-car", "routed-bike"]


def test_route_validation(client, h):
    assert client.get(ROUTE + "plane", headers=h).status_code == 422
    assert client.get("/api/nav/route?from_lat=11&from_lon=77", headers=h).status_code == 422


@pytest.mark.parametrize(
    "q",
    [
        "from_lat=13.08&from_lon=80.27&to_lat=11.01&to_lon=76.96",
        "from_lat=11.0&from_lon=76.95&to_lat=13.08&to_lon=80.27",
    ],
)
def test_route_outside_area(client, h, q):
    called = []
    fake(lambda req: called.append(1) or httpx.Response(200, json=OSRM))
    r = client.get(f"/api/nav/route?{q}&mode=car", headers=h)
    assert r.status_code == 422 and r.json() == {"detail": RESTRICTION_MESSAGE}
    assert not called


def test_route_nan_rejected(client, h):
    r = client.get("/api/nav/route?from_lat=nan&from_lon=76.95&to_lat=11.01&to_lon=76.96&mode=car", headers=h)
    assert r.status_code == 422


def test_route_no_route_404(client, h):
    fake(lambda req: httpx.Response(200, json={"code": "NoRoute", "routes": []}))
    r = client.get(ROUTE + "car", headers=h)
    assert r.status_code == 404
    r = client.get(ROUTE + "bike", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == "Bicycle routing is not available for this trip"


def test_route_provider_failures_502(client, h):
    for handler in (
        lambda req: httpx.Response(503),
        lambda req: httpx.Response(200, text="<html>"),
        lambda req: httpx.Response(200, json={"code": "Ok", "routes": [{"distance": "x"}]}),
        lambda req: httpx.Response(200, json={"code": "InvalidQuery"}),
    ):
        fake(handler)
        assert client.get(ROUTE + "car", headers=h).status_code == 502


def test_route_timeout_502(client, h):
    def handler(req):
        raise httpx.ReadTimeout("slow")

    fake(handler)
    assert client.get(ROUTE + "car", headers=h).status_code == 502


# ---- instruction builder ----


@pytest.mark.parametrize(
    "type_,modifier,name,exit_,expected",
    [
        ("turn", "left", "MG Road", None, "Turn left onto MG Road"),
        ("turn", "right", "", None, "Turn right"),
        ("turn", "slight left", "A St", None, "Turn slight left onto A St"),
        ("turn", "sharp right", None, None, "Turn sharp right"),
        ("turn", "straight", "B St", None, "Continue straight onto B St"),
        ("turn", "uturn", "", None, "Make a U-turn"),
        ("continue", "straight", "NH 544", None, "Continue straight on NH 544"),
        ("continue", None, "", None, "Continue"),
        ("new name", "slight right", "C St", None, "Continue slight right onto C St"),
        ("depart", "right", "", None, "Head out"),
        ("arrive", "left", "E St", None, "You have arrived at your destination, on the left"),
        ("arrive", None, "", None, "You have arrived at your destination"),
        ("roundabout", "right", "F Rd", 2, "At the roundabout, take exit 2 onto F Rd"),
        ("roundabout", "right", "", 3, "At the roundabout, take exit 3"),
        ("rotary", "left", "", None, "At the roundabout, continue"),
        ("roundabout turn", "left", "R Rd", None, "At the roundabout, turn left onto R Rd"),
        ("roundabout", "right", "", 0, "At the roundabout, continue"),
        ("roundabout", "right", "", "2", "At the roundabout, continue"),
        ("continue", "uturn", "X St", None, "Make a U-turn onto X St"),
        ("merge", "straight", "H Hwy", None, "Merge onto H Hwy"),
        ("merge", None, "", None, "Merge"),
        ("exit roundabout", "right", "G Rd", None, "Exit the roundabout onto G Rd"),
        ("merge", "left", "H Hwy", None, "Merge left onto H Hwy"),
        ("fork", "slight right", "", None, "Keep slight right at the fork"),
        ("end of road", "left", "I St", None, "At the end of the road, turn left onto I St"),
        ("on ramp", "right", "", None, "Take the ramp on the right"),
        ("off ramp", "left", "J Rd", None, "Take the exit on the left onto J Rd"),
        ("teleport", None, "K St", None, "Continue on K St"),
        ("teleport", "weird", "", None, "Continue"),
    ],
)
def test_build_instruction(type_, modifier, name, exit_, expected):
    assert build_instruction(type_, modifier, name, exit_) == expected


@pytest.mark.parametrize(
    "bearing,name,expected",
    [
        (0, "D Rd", "Head north on D Rd"),
        (359, "", "Head north"),
        (45, "A", "Head north-east on A"),
        (90, "", "Head east"),
        (135, "", "Head south-east"),
        (180, "", "Head south"),
        (225, "", "Head south-west"),
        (270, "", "Head west"),
        (315, "", "Head north-west"),
        (None, "", "Head out"),
        ("junk", "B", "Head out on B"),
        (float("nan"), "", "Head out"),
    ],
)
def test_depart_uses_bearing(bearing, name, expected):
    assert build_instruction("depart", "right", name, None, bearing) == expected


NO_SEGMENT = "No road or path found near one of these points"


def test_no_segment_404_http_400(client, h):
    fake(lambda req: httpx.Response(400, json={"code": "NoSegment", "message": "Could not find a matching segment"}))
    r = client.get(ROUTE + "car", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == NO_SEGMENT


def test_no_segment_404_http_200_body(client, h):
    fake(lambda req: httpx.Response(200, json={"code": "NoSegment"}))
    r = client.get(ROUTE + "foot", headers=h)
    assert r.status_code == 404 and r.json()["detail"] == NO_SEGMENT


def test_other_400_stays_502(client, h):
    fake(lambda req: httpx.Response(400, json={"code": "InvalidQuery"}))
    assert client.get(ROUTE + "car", headers=h).status_code == 502


def test_provider_nan_is_502(client, h):
    bad = (
        b'{"code":"Ok","routes":[{"distance":NaN,"duration":1,'
        b'"geometry":{"type":"LineString","coordinates":[]},"legs":[]}]}'
    )
    fake(lambda req: httpx.Response(200, content=bad))
    assert client.get(ROUTE + "car", headers=h).status_code == 502


def test_in_service_area_overflow():
    from app.geo import in_service_area

    assert not in_service_area(10**400, 76.9)


def test_single_flight_identical_misses():
    import asyncio

    calls = []

    async def handler(req):
        calls.append(1)
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=NOMINATIM)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await asyncio.gather(*(nav_service.search_places(c, "gandhipuram") for _ in range(3)))

    out = asyncio.run(run())
    assert out[0] == out[1] == out[2] and len(calls) == 1


def test_client_config_and_user_agent():
    from app.config import settings

    assert nav.get_http_client().follow_redirects is False
    assert settings.nominatim_user_agent.startswith("ThirdEye/1.0 (student project")
    assert "contact email" in settings.nominatim_user_agent
