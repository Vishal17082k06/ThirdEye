import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Must be set before app.config is imported: the production secret guard
# would otherwise refuse the dev JWT secret used in tests.
os.environ["APP_ENV"] = "dev"

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """TestClient backed by a private in-memory SQLite database.

    StaticPool keeps one shared connection so every session sees the same
    in-memory database; the real thirdeye.db is never opened.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Iterator:
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    # Not used as a context manager on purpose: the startup hook would
    # create_all on the real engine.
    test_client = TestClient(app)
    test_client.session_factory = TestingSession  # for tests that touch the DB directly
    yield test_client
    app.dependency_overrides.clear()
    engine.dispose()
