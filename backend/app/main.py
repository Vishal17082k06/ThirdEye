from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import check_jwt_secret, settings
from app.db import Base, engine
from app.routers import auth, detect, devices, events, nav, notifications, profile, rides
from app.routers import settings as settings_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    check_jwt_secret(settings)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Third Eye", lifespan=lifespan)
app.include_router(auth.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(detect.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(nav.router, prefix="/api")
app.include_router(rides.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    # The default handler echoes the rejected input back, which crashes the
    # response encoder (500) when that input is NaN/Infinity. Keep the standard
    # shape but drop the echoed values.
    errors = [{k: v for k, v in e.items() if k not in ("input", "ctx", "url")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
