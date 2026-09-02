"""
OAuth support for GitHub social sign-in.

Google is handled separately in auth_routes.py via Google Identity Services'
ID-token verification (google.oauth2.id_token) - that flow needs no
server-side code exchange, just a Client ID. GitHub doesn't offer
an equivalent client-side SDK, so it uses the standard OAuth 2.0 /
OpenID Connect Authorization Code flow implemented here.

Stateless by design (no server-side session or cache), so this works
unmodified behind multiple gunicorn workers:
  - CSRF `state` is a short-lived itsdangerous-signed token, round-tripped
    via an httponly cookie set on the initial redirect and compared against
    the `state` query param the provider echoes back on callback.
  - After a successful callback, instead of putting the real JWT in the
    redirect URL (which browsers keep in history/referrers), the frontend
    gets a short-lived one-time "exchange code" (also itsdangerous-signed).
    It immediately POSTs that to /api/auth/exchange to get the actual JWT
    back over JSON - the same create_access_token() used everywhere else.
"""
import secrets
from urllib.parse import urlencode
import requests
from flask import current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from app.extensions import db
from app.models import User

STATE_COOKIE_NAME = "oauth_state"
STATE_MAX_AGE_SECONDS = 600         # 10 min to complete the provider's consent screen
EXCHANGE_CODE_MAX_AGE_SECONDS = 60  # frontend must redeem it almost immediately


class OAuthError(Exception):
    """Message is safe to show directly to the user."""
    pass


def _serializer(salt):
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=salt)


# --- CSRF state (cookie <-> redirect param round trip) ---------------------

def issue_state(provider: str) -> str:
    return _serializer("oauth-state").dumps({"provider": provider, "nonce": secrets.token_urlsafe(16)})


def verify_state(provider: str, state_param: str, cookie_value: str):
    if not state_param or not cookie_value or state_param != cookie_value:
        raise OAuthError("Invalid or missing OAuth state. Please try signing in again.")
    try:
        data = _serializer("oauth-state").loads(state_param, max_age=STATE_MAX_AGE_SECONDS)
    except SignatureExpired:
        raise OAuthError("That sign-in attempt expired. Please try again.")
    except BadSignature:
        raise OAuthError("Invalid OAuth state. Please try signing in again.")
    if data.get("provider") != provider:
        raise OAuthError("OAuth state provider mismatch.")


# --- One-time exchange code (callback redirect -> real JWT) ----------------

def issue_exchange_code(user_id: str) -> str:
    return _serializer("oauth-exchange").dumps({"uid": user_id})


def consume_exchange_code(code: str) -> str:
    """Returns the user id, or raises OAuthError."""
    try:
        data = _serializer("oauth-exchange").loads(code, max_age=EXCHANGE_CODE_MAX_AGE_SECONDS)
    except SignatureExpired:
        raise OAuthError("This sign-in link expired. Please try again.")
    except BadSignature:
        raise OAuthError("Invalid sign-in code.")
    uid = data.get("uid")
    if not uid:
        raise OAuthError("Invalid sign-in code.")
    return uid


# --- Shared account find-or-create/link logic -------------------------------

def find_or_create_social_user(provider: str, provider_id_field: str, provider_id: str, email: str, name: str) -> User:
    """
    Shared account-linking logic for Google/GitHub.
      - Looks up by the provider's own id column first (fast path for repeat logins).
      - Falls back to matching by email and links the new provider id onto
        that existing account instead of creating a duplicate - e.g. someone
        who registered with a password using asha@x.com later hits
        "Continue with Google" using the same, Google-verified asha@x.com
        gets logged into the SAME account, not a second one.
      - Creates a brand-new account only if neither match succeeds.
    Never overwrites an existing password hash or the account's original
    auth_provider (that field just records how they first signed up).
    """
    user = User.query.filter(getattr(User, provider_id_field) == provider_id).first()
    if user:
        if not user.email_verified:
            user.email_verified = True
            db.session.commit()
        return user

    user = User.query.filter_by(email=email).first()
    if user:
        setattr(user, provider_id_field, provider_id)
        if not user.email_verified:
            user.email_verified = True
        db.session.commit()
        return user

    safe_name = (name or "").strip() or email.split("@")[0]
    user = User(
        name=safe_name,
        email=email,
        password_hash=None,
        auth_provider=provider,
        email_verified=True,
        **{provider_id_field: provider_id},
    )
    db.session.add(user)
    db.session.commit()
    return user


# --- GitHub ------------------------------------------------------------------

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAILS_URL = "https://api.github.com/user/emails"


def github_authorize_url(state: str) -> str:
    cfg = current_app.config
    params = {
        "client_id": cfg["GITHUB_CLIENT_ID"],
        "redirect_uri": cfg["GITHUB_REDIRECT_URI"],
        "scope": "read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


def github_exchange_and_fetch_profile(code: str) -> dict:
    """Returns {"provider_id": str, "email": str, "name": str}. Raises OAuthError."""
    cfg = current_app.config
    if not cfg["GITHUB_CLIENT_ID"] or not cfg["GITHUB_CLIENT_SECRET"]:
        raise OAuthError("GitHub Sign-In is not configured on the server.")

    token_resp = requests.post(
        GITHUB_TOKEN_URL,
        headers={"Accept": "application/json"},
        data={
            "client_id": cfg["GITHUB_CLIENT_ID"],
            "client_secret": cfg["GITHUB_CLIENT_SECRET"],
            "code": code,
            "redirect_uri": cfg["GITHUB_REDIRECT_URI"],
        },
        timeout=15,
    )
    if token_resp.status_code != 200:
        raise OAuthError("GitHub token exchange failed.")
    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise OAuthError(token_data.get("error_description") or "GitHub did not return an access token.")

    auth_header = {"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"}

    user_resp = requests.get(GITHUB_USER_URL, headers=auth_header, timeout=15)
    if user_resp.status_code != 200:
        raise OAuthError("Couldn't fetch your GitHub profile.")
    profile = user_resp.json()

    email = profile.get("email")
    if not email:
        # Public email hidden on their profile - look it up via the emails
        # API instead (works as long as the user:email scope was granted).
        emails_resp = requests.get(GITHUB_EMAILS_URL, headers=auth_header, timeout=15)
        if emails_resp.status_code == 200:
            emails = emails_resp.json()
            primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
            verified = next((e for e in emails if e.get("verified")), None)
            chosen = primary or verified
            if chosen:
                email = chosen.get("email")

    if not email:
        raise OAuthError(
            "GitHub didn't share a verified email address. Please make an email "
            "public in your GitHub settings, or sign in with a different method."
        )

    provider_id = str(profile.get("id"))
    name = profile.get("name") or profile.get("login") or email.split("@")[0]
    return {"provider_id": provider_id, "email": email.strip().lower(), "name": name}



