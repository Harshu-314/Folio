import uuid
from datetime import datetime
from app.extensions import db


def gen_uuid():
    return str(uuid.uuid4())


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=gen_uuid)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(180), unique=True, nullable=False, index=True)
    # Nullable because Google-signed-up users have no local password.
    password_hash = db.Column(db.String(255), nullable=True)

    auth_provider = db.Column(db.String(20), nullable=False, default="password")  # password | google | github
    google_id = db.Column(db.String(64), unique=True, nullable=True, index=True)
    github_id = db.Column(db.String(64), unique=True, nullable=True, index=True)
    # NOTE: the `linkedin_id` column still exists in the database (added by
    # migrate_social_auth.py) but is no longer used now that LinkedIn
    # Sign-In has been removed. Left in place to avoid a schema migration;
    # safe to drop in a future cleanup.

    plan = db.Column(db.String(20), nullable=False, default="free")  # free | premium
    ats_checks_used = db.Column(db.Integer, nullable=False, default=0)

    # --- Profile Information ---
    phone = db.Column(db.String(30), nullable=True)
    location = db.Column(db.String(120), nullable=True)
    headline = db.Column(db.String(150), nullable=True)

    # --- AI Career Profile ---
    current_status = db.Column(db.String(50), nullable=True)  # Student | Fresher | Working Professional
    target_role = db.Column(db.String(150), nullable=True)
    years_of_experience = db.Column(db.String(30), nullable=True)
    career_goal = db.Column(db.Text, nullable=True)
    preferred_location = db.Column(db.String(120), nullable=True)

    # --- Email verification (OTP sent on signup) ---
    email_verified = db.Column(db.Boolean, nullable=False, default=False)
    otp_hash = db.Column(db.String(255), nullable=True)
    otp_expires_at = db.Column(db.DateTime, nullable=True)
    otp_attempts = db.Column(db.Integer, nullable=False, default=0)
    otp_last_sent_at = db.Column(db.DateTime, nullable=True)

    # --- Forgot-password reset (separate OTP fields so a pending signup
    # verification and a pending password reset never collide) ---
    reset_otp_hash = db.Column(db.String(255), nullable=True)
    reset_otp_expires_at = db.Column(db.DateTime, nullable=True)
    reset_otp_attempts = db.Column(db.Integer, nullable=False, default=0)
    reset_otp_last_sent_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resumes = db.relationship("Resume", backref="owner", lazy=True, cascade="all, delete-orphan")
    transactions = db.relationship("Transaction", backref="user", lazy=True, cascade="all, delete-orphan")
    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "plan": self.plan,
            "auth_provider": self.auth_provider,
            "ats_checks_used": self.ats_checks_used,
            "email_verified": self.email_verified,
            "phone": self.phone or "",
            "location": self.location or "",
            "headline": self.headline or "",
            "current_status": self.current_status or "",
            "target_role": self.target_role or "",
            "years_of_experience": self.years_of_experience or "",
            "career_goal": self.career_goal or "",
            "preferred_location": self.preferred_location or "",
            "google_connected": bool(self.google_id or self.auth_provider == "google"),
            "github_connected": bool(self.github_id or self.auth_provider == "github"),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    FREE_ATS_CHECK_LIMIT = 3

    def ats_checks_remaining(self):
        if self.plan == "premium":
            return None  # unlimited
        return max(0, self.FREE_ATS_CHECK_LIMIT - self.ats_checks_used)
