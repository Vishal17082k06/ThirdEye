from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import check_jwt_secret, settings
from app.db import Base, engine
from app.routers import auth


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    check_jwt_secret(settings)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Third Eye", lifespan=lifespan)
app.include_router(auth.router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
