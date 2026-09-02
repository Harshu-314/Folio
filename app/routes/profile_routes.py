from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models import User, Resume
from app.utils import error_response, success_response

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")


def _get_user_stats(user_id):
    total_resumes = Resume.query.filter_by(user_id=user_id).count()
    return {
        "total_resumes": total_resumes
    }


@profile_bp.route("", methods=["GET"])
@jwt_required()
def get_profile():
    user_id = get_jwt_identity()
    user = db.session.get(User, user_id)
    if not user:
        return error_response("User not found.", 404)

    stats = _get_user_stats(user.id)
    return success_response({"user": user.to_dict(), "stats": stats})


@profile_bp.route("", methods=["PUT"])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    user = db.session.get(User, user_id)
    if not user:
        return error_response("User not found.", 404)

    data = request.get_json(silent=True) or {}

    if "name" in data and data["name"] is not None:
        name = str(data["name"]).strip()
        if name:
            user.name = name

    if "phone" in data:
        user.phone = (str(data["phone"]).strip() if data["phone"] else None)

    if "location" in data:
        user.location = (str(data["location"]).strip() if data["location"] else None)

    if "headline" in data:
        user.headline = (str(data["headline"]).strip() if data["headline"] else None)

    if "current_status" in data:
        user.current_status = (str(data["current_status"]).strip() if data["current_status"] else None)

    if "target_role" in data:
        user.target_role = (str(data["target_role"]).strip() if data["target_role"] else None)

    if "years_of_experience" in data:
        user.years_of_experience = (str(data["years_of_experience"]).strip() if data["years_of_experience"] else None)

    if "career_goal" in data:
        user.career_goal = (str(data["career_goal"]).strip() if data["career_goal"] else None)

    if "preferred_location" in data:
        user.preferred_location = (str(data["preferred_location"]).strip() if data["preferred_location"] else None)

    db.session.commit()

    stats = _get_user_stats(user.id)
    return success_response(
        {"user": user.to_dict(), "stats": stats},
        message="Profile updated successfully."
    )
