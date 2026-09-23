import os
from datetime import timedelta
from dotenv import load_dotenv

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")

    # --- Database ---
    _raw_db_url = os.getenv(
        "DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'instance', 'resume_builder.sqlite')}"
    )
    # Fix for SQLAlchemy requiring 'postgresql://' instead of 'postgres://' (common on Render / Railway / Heroku)
    if _raw_db_url.startswith("postgres://"):
        _raw_db_url = _raw_db_url.replace("postgres://", "postgresql://", 1)
    SQLALCHEMY_DATABASE_URI = _raw_db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- JWT ---
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        hours=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_HOURS", 168))
    )
    JWT_TOKEN_LOCATION = ["headers"]

    # --- AI Provider ---
    AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini")  # "openai" or "gemini"
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

    # --- Google Sign-In ---
    # Current implementation verifies a Google Identity Services ID token
    # (see /api/auth/google) which only needs the Client ID - no secret or
    # redirect URI required, since there's no server-side code exchange.
    # GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI are accepted here for naming
    # consistency with GitHub below and for a future redirect-flow
    # migration, but are not read anywhere yet.
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")

    # --- GitHub OAuth ---
    GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
    GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
    GITHUB_REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:5000/api/auth/github/callback")

    # Where to send the browser back to after a GitHub redirect-based
    # login completes. Deliberately separate from CLIENT_URL (which is a CORS
    # allow-list and may be "*") - this must be one concrete origin.
    FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")

    # --- CORS ---
    CLIENT_URL = os.getenv("CLIENT_URL", "*")

    # --- Business ---
    PREMIUM_PRICE_MONTHLY_INR = int(os.getenv("PREMIUM_PRICE_MONTHLY_INR", 199))
    PREMIUM_PRICE_ANNUAL_INR = int(os.getenv("PREMIUM_PRICE_ANNUAL_INR", 1999))
    PREMIUM_PRICE_INR = PREMIUM_PRICE_MONTHLY_INR

    # --- Rate limiting ---
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")

    # --- Email (signup verification OTP) ---
    # "console": logs the email instead of sending it -- zero config, works
    # out of the box for local dev/demo. "smtp": sends via any standard SMTP
    # server/relay (Gmail app password, Mailtrap, SendGrid/Resend/SES SMTP).
    EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "console")
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
    SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    EMAIL_FROM_ADDRESS = os.getenv("EMAIL_FROM_ADDRESS", "no-reply@resumefolio.local")
    EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "ResumeFolio")
    OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", 10))
    OTP_RESEND_COOLDOWN_SECONDS = int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", 60))
    OTP_MAX_ATTEMPTS = int(os.getenv("OTP_MAX_ATTEMPTS", 5))


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}
