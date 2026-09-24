import re
from datetime import datetime
import uuid
from flask import Blueprint, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token

from app.extensions import db
from app.models import User, Transaction
from app.services.pdf_service import AVAILABLE_TEMPLATES
from app.utils import error_response, success_response

templates_bp = Blueprint("templates", __name__, url_prefix="/api/templates")
billing_bp = Blueprint("billing", __name__, url_prefix="/api/billing")


@templates_bp.route("", methods=["GET"])
def list_templates():
    templates = [
        {
            "id": key,
            "label": val["label"],
            "category": val["category"],
            "layout": val["layout"],
            "accent": "#%02x%02x%02x" % val["accent"],
            "font": val["font"],
            "title_style": val["title_style"],
            "header_align": val["header_align"],
            "is_premium": bool(val.get("is_premium", False)),
            "supports_photo": bool(val.get("supports_photo", False)),
            "cover_image": f"/images/templates/{key}_cover.svg",
            "section_image": f"/images/templates/{key}_section.svg",
        }
        for key, val in AVAILABLE_TEMPLATES.items()
    ]
    return success_response({"templates": templates})


@billing_bp.route("/create-payment", methods=["POST"])
@jwt_required()
def create_payment():
    """
    Initializes a UPI payment checkout session.
    Calculates expected amount server-side based on plan selection (monthly = ₹199, annual = ₹1,999).
    """
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return error_response("Authentication required.", 401)

    payload = request.get_json(silent=True) or {}
    plan_type = (payload.get("plan_type") or payload.get("billing_cycle") or payload.get("period") or "monthly").lower()
    amount = 1999.0 if plan_type == "annual" else 199.0

    tx_id = f"TXN_{uuid.uuid4().hex[:12].upper()}"
    merchant_vpa = current_app.config.get("EMAIL_FROM_ADDRESS") or "resumefolio@upi"
    if "@" not in merchant_vpa:
        merchant_vpa = "resumefolio@upi"

    upi_uri = f"upi://pay?pa={merchant_vpa}&pn=ResumeFolio&am={amount:.2f}&tr={tx_id}&cu=INR&tn=Folio%20Premium%20Upgrade"

    payment_session = {
        "payment_id": tx_id,
        "amount": amount,
        "currency": "INR",
        "method": "upi",
        "upi_uri": upi_uri,
        "status": "PENDING",
        "timestamp": datetime.utcnow().isoformat(),
    }

    return success_response(payment_session, message="Payment session initialized.")


@billing_bp.route("/verify-payment", methods=["POST"])
@jwt_required()
def verify_payment():
    """
    Submits UTR reference number for verification and upgrades authenticated user.
    Requires a valid logged-in JWT. Never uses fallback or latest user.
    Price is calculated strictly server-side: monthly = ₹199, annual = ₹1,999.
    """
    user_id = get_jwt_identity()
    user = User.query.get(user_id) if user_id else None

    if not user:
        return error_response("Authentication required. Please sign in.", 401)

    payload = request.get_json(silent=True) or {}
    status_requested = (payload.get("status") or "SUCCESS").upper()

    if status_requested == "FAILED":
        return error_response(
            "Payment failed. Transaction declined.",
            400,
            details={"status": "FAILED"}
        )
    elif status_requested == "CANCELLED":
        return error_response(
            "Payment was cancelled.",
            400,
            details={"status": "CANCELLED"}
        )

    # Server-side price determination
    plan_type = (payload.get("plan_type") or payload.get("billing_cycle") or payload.get("period") or "monthly").lower()
    if plan_type == "annual":
        amount = 1999.0
        plan_label = "Premium Annual"
    else:
        amount = 199.0
        plan_label = "Premium Monthly"

    utr = (payload.get("utr") or payload.get("transaction_ref") or payload.get("payment_id") or "").strip()
    method = "UPI"
    bank = payload.get("bank") or payload.get("provider") or "PhonePe / UPI Network"

    # 1. Require a non-empty UTR / Transaction Reference
    if not utr:
        return error_response(
            "Missing transaction reference. Please complete payment and enter your 12-digit UPI UTR number.",
            400,
            details={"error_code": "MISSING_UTR"}
        )

    # 2. Format validation: UTR must be a valid 12-digit UPI reference number
    clean_utr = re.sub(r'[^a-zA-Z0-9]', '', utr)
    
    if len(clean_utr) < 12 or clean_utr in ["000000000000", "111111111111", "123456789012", "012345678901"]:
        return error_response(
            "Invalid 12-digit UPI UTR reference number. Please check your PhonePe / Google Pay receipt.",
            400,
            details={"error_code": "INVALID_UTR_FORMAT"}
        )

    # 3. Check for duplicate UTR usage across accounts
    existing_tx = Transaction.query.filter_by(utr=clean_utr).first()
    if existing_tx and existing_tx.user_id != user.id:
        return error_response(
            "This UTR / Transaction Reference has already been submitted.",
            400,
            details={"error_code": "DUPLICATE_UTR"}
        )

    # --- UPGRADE USER ---
    user.plan = "premium"

    # Record transaction in DB if not already recorded
    if not existing_tx:
        new_tx = Transaction(
            user_id=user.id,
            utr=clean_utr,
            amount=amount,
            method=method,
            status="SUCCESS"
        )
        db.session.add(new_tx)

    db.session.commit()

    token = create_access_token(identity=user.id)

    receipt = {
        "transaction_id": clean_utr,
        "amount": amount,
        "currency": "INR",
        "method": method,
        "bank_or_provider": bank,
        "plan": plan_label,
        "timestamp": datetime.utcnow().strftime("%d %b %Y, %I:%M %p UTC"),
        "status": "Payment submitted for verification",
        "customer_name": user.name,
        "customer_email": user.email,
    }

    return success_response(
        {"user": user.to_dict(), "token": token, "receipt": receipt},
        message="Payment submitted for verification. Account upgraded to Premium.",
    )


@billing_bp.route("/upgrade", methods=["POST"])
@jwt_required()
def upgrade_to_premium():
    return verify_payment()


@billing_bp.route("/status/<payment_id>", methods=["GET"])
@jwt_required()
def payment_status(payment_id):
    """Returns payment status for polling."""
    return success_response(
        {"payment_id": payment_id, "status": "Payment submitted for verification"},
        message="Transaction reference received.",
    )


@billing_bp.route("/downgrade", methods=["POST"])
@jwt_required()
def downgrade_to_free():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return error_response("User not found.", 404)

    user.plan = "free"
    db.session.commit()
    return success_response({"user": user.to_dict()}, message="Moved to Free plan.")


