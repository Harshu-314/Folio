from datetime import datetime, timedelta
from urllib.parse import urlencode

from flask import Blueprint, request, current_app, redirect
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from app.extensions import db, bcrypt, limiter
from app.models import User
from app.services.email_service import send_verification_email, send_password_reset_email
from app.services import oauth_service
from app.services.oauth_service import OAuthError
from app.utils import (
    is_valid_email,
    is_valid_password,
    is_disposable_email,
    password_requirements_message,
    generate_otp,
    is_valid_otp_format,
    error_response,
    success_response,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _frontend_url(**params) -> str:
    base = (current_app.config.get("FRONTEND_BASE_URL") or "http://localhost:3000").rstrip("/")
    query = urlencode(params)
    return f"{base}/?{query}" if query else f"{base}/"


def _issue_otp(user):
    """Generates a fresh OTP, hashes+stores it on the user, and emails it.
    Returns True if the email was sent (or logged, in console mode)."""
    otp_code = generate_otp()
    user.otp_hash = bcrypt.generate_password_hash(otp_code).decode("utf-8")
    expiry_minutes = current_app.config.get("OTP_EXPIRY_MINUTES", 10)
    user.otp_expires_at = datetime.utcnow() + timedelta(minutes=expiry_minutes)
    user.otp_attempts = 0
    user.otp_last_sent_at = datetime.utcnow()
    db.session.commit()
    return send_verification_email(user.email, user.name, otp_code)


def _ensure_pending_otp(user):
    """Makes sure the user has a currently-valid OTP, issuing (and emailing)
    a fresh one only if there isn't one or it expired. Used when login is
    blocked for an unverified account, so they always land on a usable code
    without spamming a new email on every blocked login attempt."""
    if user.otp_hash and user.otp_expires_at and datetime.utcnow() < user.otp_expires_at:
        return True
    return _issue_otp(user)


@auth_bp.route("/register", methods=["POST"])
@limiter.limit("10 per hour")
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not name:
        return error_response("Name is required.")
    if not is_valid_email(email):
        return error_response("A valid email is required.")
    if is_disposable_email(email):
        return error_response(
            "Temporary/disposable email addresses aren't allowed. Please use your real email."
        )
    if not is_valid_password(password):
        return error_response(password_requirements_message())

    existing = User.query.filter_by(email=email).first()
    if existing:
        if existing.auth_provider == "google" and not existing.password_hash:
            return error_response(
                "This email is registered via Google Sign-In. Please use 'Sign in with Google' instead.",
                409,
            )
        return error_response("An account with this email already exists.", 409)

    password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
    user = User(name=name, email=email, password_hash=password_hash, email_verified=False)
    db.session.add(user)
    db.session.commit()

    _issue_otp(user)

    # No token yet on purpose -- the account has no session until the OTP
    # is confirmed via /verify-email, which is what actually logs them in.
    return success_response(
        {"user": user.to_dict()},
        message="Account created. Enter the verification code sent to your email to finish signing in.",
        status=201,
    )


@auth_bp.route("/login", methods=["POST"])
@limiter.limit("20 per hour")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    user = User.query.filter_by(email=email).first()
    if not user or not user.password_hash:
        return error_response("Invalid email or password.", 401)
    if not bcrypt.check_password_hash(user.password_hash, password):
        return error_response("Invalid email or password.", 401)

    if not user.email_verified:
        _ensure_pending_otp(user)
        return error_response(
            "Please verify your email before signing in. We've sent a code to your inbox.",
            403,
            details={"email_verification_required": True, "email": user.email},
        )

    token = create_access_token(identity=user.id)
    return success_response({"token": token, "user": user.to_dict()}, message="Logged in.")


@auth_bp.route("/google", methods=["POST"])
@limiter.limit("20 per hour")
def google_signin():
    """
    Body: { "id_token": "<the credential from Google Identity Services>" }

    Verifies the ID token with Google, then either logs the user in (matched
    by google_id or by a pre-existing password account with the same,
    Google-verified email) or creates a brand-new account. Google has
    already verified the email address at this point, so these accounts
    skip the OTP flow entirely.
    """
    client_id = current_app.config.get("GOOGLE_CLIENT_ID")
    if not client_id:
        return error_response("Google Sign-In is not configured on the server.", 500)

    data = request.get_json(silent=True) or {}
    token = data.get("id_token")
    if not token:
        return error_response("`id_token` is required.")

    try:
        payload = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), client_id
        )
    except ValueError:
        return error_response("Invalid Google token.", 401)

    if not payload.get("email_verified", False):
        return error_response("Google account email is not verified.", 401)

    google_sub = payload["sub"]
    email = payload["email"].strip().lower()
    name = payload.get("name") or email.split("@")[0]

    user = oauth_service.find_or_create_social_user("google", "google_id", google_sub, email, name)

    token_out = create_access_token(identity=user.id)
    return success_response({"token": token_out, "user": user.to_dict()}, message="Signed in with Google.")


# --- GitHub OAuth (Authorization Code flow) ---------------------------------

@auth_bp.route("/github", methods=["GET"])
@limiter.limit("20 per hour")
def github_login():
    """Browser-navigated (not fetch/AJAX): redirects straight to GitHub's
    consent screen. See app/services/oauth_service.py for the full flow."""
    if not current_app.config.get("GITHUB_CLIENT_ID"):
        return redirect(_frontend_url(social_auth_error="GitHub Sign-In is not configured on the server."))

    state = oauth_service.issue_state("github")
    resp = redirect(oauth_service.github_authorize_url(state))
    resp.set_cookie(
        oauth_service.STATE_COOKIE_NAME, state,
        max_age=oauth_service.STATE_MAX_AGE_SECONDS,
        httponly=True, samesite="Lax", secure=request.is_secure,
    )
    return resp


@auth_bp.route("/github/callback", methods=["GET"])
@limiter.limit("20 per hour")
def github_callback():
    provider_error = request.args.get("error")
    if provider_error:
        message = "You cancelled GitHub sign-in." if provider_error == "access_denied" \
            else f"GitHub sign-in failed: {provider_error}"
        resp = redirect(_frontend_url(social_auth_error=message))
        resp.delete_cookie(oauth_service.STATE_COOKIE_NAME)
        return resp

    try:
        oauth_service.verify_state("github", request.args.get("state"), request.cookies.get(oauth_service.STATE_COOKIE_NAME))
        code = request.args.get("code")
        if not code:
            raise OAuthError("GitHub did not return an authorization code.")
        profile = oauth_service.github_exchange_and_fetch_profile(code)
        user = oauth_service.find_or_create_social_user(
            "github", "github_id", profile["provider_id"], profile["email"], profile["name"]
        )
    except OAuthError as e:
        resp = redirect(_frontend_url(social_auth_error=str(e)))
        resp.delete_cookie(oauth_service.STATE_COOKIE_NAME)
        return resp

    exchange_code = oauth_service.issue_exchange_code(user.id)
    resp = redirect(_frontend_url(social_auth=exchange_code))
    resp.delete_cookie(oauth_service.STATE_COOKIE_NAME)
    return resp


# --- Shared exchange endpoint (GitHub redirect -> real JWT) ----------------

@auth_bp.route("/exchange", methods=["POST"])
@limiter.limit("30 per hour")
def exchange_social_auth_code():
    """
    Redeems the short-lived one-time code from a GitHub redirect
    (see oauth_service.issue_exchange_code) for the application's real JWT -
    the same create_access_token() used by every other login path. Keeping
    the JWT itself out of the redirect URL avoids leaving it in browser
    history/referrers.
    """
    data = request.get_json(silent=True) or {}
    code = data.get("code")
    if not code:
        return error_response("`code` is required.")

    try:
        user_id = oauth_service.consume_exchange_code(code)
    except OAuthError as e:
        return error_response(str(e), 401)

    user = User.query.get(user_id)
    if not user:
        return error_response("Account not found.", 404)

    token = create_access_token(identity=user.id)
    return success_response({"token": token, "user": user.to_dict()}, message="Signed in.")


@auth_bp.route("/verify-email", methods=["POST"])
@limiter.limit("10 per hour")
def verify_email():
    """Public on purpose: at this point the user has no session yet (see
    /register), so there's no JWT to require. Identified by email instead;
    the per-account OTP hash + attempt lockout is what keeps this safe."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    otp = (data.get("otp") or "").strip()

    user = User.query.filter_by(email=email).first()
    if not user:
        return error_response("Invalid email or verification code.", 400)

    if user.email_verified:
        # Already verified (e.g. re-submitted from a stale tab) -- just log
        # them in rather than erroring, since that's clearly their intent.
        token = create_access_token(identity=user.id)
        return success_response({"token": token, "user": user.to_dict()}, message="Email already verified. Logged in.")

    if not user.otp_hash or not user.otp_expires_at:
        return error_response("No verification code is pending. Please request a new one.", 400)
    if datetime.utcnow() > user.otp_expires_at:
        return error_response("That code has expired. Please request a new one.", 400)
    max_attempts = current_app.config.get("OTP_MAX_ATTEMPTS", 5)
    if user.otp_attempts >= max_attempts:
        return error_response("Too many incorrect attempts. Please request a new code.", 429)

    if not is_valid_otp_format(otp) or not bcrypt.check_password_hash(user.otp_hash, otp):
        user.otp_attempts += 1
        db.session.commit()
        remaining = max(0, max_attempts - user.otp_attempts)
        return error_response(
            f"Incorrect verification code. {remaining} attempt(s) remaining.", 400
        )

    user.email_verified = True
    user.otp_hash = None
    user.otp_expires_at = None
    user.otp_attempts = 0
    db.session.commit()

    # Verification is what actually creates the session now.
    token = create_access_token(identity=user.id)
    return success_response(
        {"token": token, "user": user.to_dict()}, message="Email verified successfully!"
    )


@auth_bp.route("/resend-verification", methods=["POST"])
@limiter.limit("10 per hour")
def resend_verification():
    """Public endpoint to resend a signup verification OTP code."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    if not email:
        return error_response("Email is required.")

    user = User.query.filter_by(email=email).first()
    if not user:
        return error_response("No account found with that email address.", 404)

    if user.email_verified:
        return success_response(
            {"already_verified": True},
            message="This email is already verified. You can log in directly.",
        )

    cooldown = current_app.config.get("OTP_RESEND_COOLDOWN_SECONDS", 60)
    if user.otp_last_sent_at:
        elapsed = (datetime.utcnow() - user.otp_last_sent_at).total_seconds()
        if elapsed < cooldown:
            wait = max(1, int(cooldown - elapsed))
            return error_response(
                f"Please wait {wait}s before requesting another code.",
                429,
                details={"wait_seconds": wait},
            )

    sent = _issue_otp(user)
    if not sent:
        return error_response(
            "Couldn't send the verification email right now. Please try again shortly.", 502
        )
    return success_response(message="Verification code sent to your email.")



def _issue_reset_otp(user):
    """Same idea as _issue_otp, but for the separate password-reset flow."""
    otp_code = generate_otp()
    user.reset_otp_hash = bcrypt.generate_password_hash(otp_code).decode("utf-8")
    expiry_minutes = current_app.config.get("OTP_EXPIRY_MINUTES", 10)
    user.reset_otp_expires_at = datetime.utcnow() + timedelta(minutes=expiry_minutes)
    user.reset_otp_attempts = 0
    user.reset_otp_last_sent_at = datetime.utcnow()
    db.session.commit()
    return send_password_reset_email(user.email, user.name, otp_code)


@auth_bp.route("/forgot-password", methods=["POST"])
@limiter.limit("5 per hour")
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    user = User.query.filter_by(email=email).first()
    if not user:
        return error_response("No account found with that email.", 404)
    if not user.password_hash:
        return error_response(
            "This account signs in with Google — there's no password to reset.", 400
        )

    cooldown = current_app.config.get("OTP_RESEND_COOLDOWN_SECONDS", 60)
    if user.reset_otp_last_sent_at:
        elapsed = (datetime.utcnow() - user.reset_otp_last_sent_at).total_seconds()
        if elapsed < cooldown:
            wait = int(cooldown - elapsed)
            return error_response(
                f"Please wait {wait}s before requesting another code.",
                429,
                details={"wait_seconds": wait},
            )

    sent = _issue_reset_otp(user)
    if not sent:
        return error_response(
            "Couldn't send the reset email right now. Please try again shortly.", 502
        )
    return success_response(message="A password reset code has been sent to your email.")


@auth_bp.route("/reset-password", methods=["POST"])
@limiter.limit("10 per hour")
def reset_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    otp = (data.get("otp") or "").strip()
    new_password = (data.get("new_password") or "").strip()

    user = User.query.filter_by(email=email).first()
    if not user:
        return error_response("Invalid email or reset code.", 400)

    if not user.reset_otp_hash or not user.reset_otp_expires_at:
        return error_response("No reset code is pending. Please request a new one.", 400)
    if datetime.utcnow() > user.reset_otp_expires_at:
        return error_response("That code has expired. Please request a new one.", 400)
    max_attempts = current_app.config.get("OTP_MAX_ATTEMPTS", 5)
    if user.reset_otp_attempts >= max_attempts:
        return error_response("Too many incorrect attempts. Please request a new code.", 429)

    if not is_valid_otp_format(otp) or not bcrypt.check_password_hash(user.reset_otp_hash, otp):
        user.reset_otp_attempts += 1
        db.session.commit()
        remaining = max(0, max_attempts - user.reset_otp_attempts)
        return error_response(f"Incorrect reset code. {remaining} attempt(s) remaining.", 400)

    if not is_valid_password(new_password):
        return error_response(password_requirements_message())

    user.password_hash = bcrypt.generate_password_hash(new_password).decode("utf-8")
    user.reset_otp_hash = None
    user.reset_otp_expires_at = None
    user.reset_otp_attempts = 0
    db.session.commit()

    # Reset also logs them in, same as /verify-email does after signup.
    token = create_access_token(identity=user.id)
    return success_response(
        {"token": token, "user": user.to_dict()}, message="Password reset successfully!"
    )


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user = User.query.get(get_jwt_identity())
    if not user:
        return error_response("User not found.", 404)
    return success_response({"user": user.to_dict()})
