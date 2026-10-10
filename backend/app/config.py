"""Runtime configuration, read from environment variables (and an optional `.env`)."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+psycopg://expense_gauge:expense_gauge@localhost:5432/expense_gauge"
    )
    session_cookie_name: str = "eg_session"
    # The MVP is served over plain HTTP on localhost/LAN, so the cookie is not Secure by default.
    session_cookie_secure: bool = False
    session_ttl_days: int = 30
    login_failure_delay_seconds: float = 1.0

    @field_validator("database_url")
    @classmethod
    def _use_psycopg3(cls, value: str) -> str:
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
