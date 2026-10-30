from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Used only when JWT_SECRET is unset or blank so local development works with
# zero setup. Anyone can read this value in the repo, so it must never be
# relied on outside development: set a real JWT_SECRET in backend/.env.
DEV_JWT_SECRET = "dev-only-insecure-secret-do-not-use-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # "dev" relaxes the secret guard; anything else (default) enforces it.
    app_env: str = "production"
    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    token_expire_days: int = 1
    token_expire_days_remember: int = 30
    database_url: str = "sqlite:///./thirdeye.db"
    gmail_user: str = ""
    gmail_app_password: str = ""
    openai_api_key: str = ""
    nominatim_user_agent: str = "ThirdEye/1.0 (student project)"
    # Demo ride fare rates (INR); not real prices.
    ride_base_fare_inr: float = 30
    ride_per_km_car: float = 14
    ride_per_km_bike: float = 8

    @field_validator("jwt_secret", mode="before")
    @classmethod
    def blank_secret_uses_dev_default(cls, value: object) -> object:
        # .env.example ships "JWT_SECRET=" (blank); an empty HMAC key would be
        # worse than the dev default, so treat blank as "not set".
        if value is None or (isinstance(value, str) and not value.strip()):
            return DEV_JWT_SECRET
        return value


def check_jwt_secret(current: Settings) -> None:
    """Refuse to run outside dev with the publicly known development secret."""
    if current.app_env != "dev" and current.jwt_secret == DEV_JWT_SECRET:
        raise RuntimeError(
            "JWT_SECRET is not set (or is the development default) while APP_ENV is "
            f"{current.app_env!r}. Set a strong JWT_SECRET in backend/.env, or set "
            "APP_ENV=dev for local development."
        )


settings = Settings()
