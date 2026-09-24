from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models import Resume
from app.services.pdf_service import AVAILABLE_TEMPLATES
from app.utils import error_response, success_response

resume_bp = Blueprint("resumes", __name__, url_prefix="/api/resumes")


@resume_bp.route("", methods=["GET"])
@jwt_required()
def list_resumes():
    user_id = get_jwt_identity()
    resumes = Resume.query.filter_by(user_id=user_id).order_by(Resume.updated_at.desc()).all()
    return success_response({"resumes": [r.to_dict(include_content=False) for r in resumes]})


@resume_bp.route("/<resume_id>", methods=["GET"])
@jwt_required()
def get_resume(resume_id):
    user_id = get_jwt_identity()
    resume = Resume.query.filter_by(id=resume_id, user_id=user_id).first()
    if not resume:
        return error_response("Resume not found.", 404)
    return success_response({"resume": resume.to_dict()})


@resume_bp.route("", methods=["POST"])
@jwt_required()
def create_resume():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    title = (data.get("title") or "Untitled Resume").strip()
    template_id = data.get("template_id", "minimal")
    if template_id not in AVAILABLE_TEMPLATES:
        return error_response(
            f"Unknown template_id. Choose one of: {list(AVAILABLE_TEMPLATES.keys())}"
        )

    resume = Resume(
        user_id=user_id,
        title=title,
        template_id=template_id,
        target_job_title=data.get("target_job_title"),
        target_job_description=data.get("target_job_description"),
    )
    #resume.set_content(data.get("content", {}))
    # Support both flat payloads and legacy "content" payloads.
    content = data.get("content")

    if content is None:
        content = {
            "summary": data.get("summary", ""),
            "education": data.get("education", []),
            "experience": data.get("experience", []),
            "projects": data.get("projects", []),
            "skills": data.get("skills", []),
            "certifications": data.get("certifications", [])
    }

    resume.set_content(content)
    db.session.add(resume)
    db.session.commit()

    return success_response({"resume": resume.to_dict()}, message="Resume created.", status=201)


@resume_bp.route("/<resume_id>", methods=["PUT"])
@jwt_required()
def update_resume(resume_id):
    user_id = get_jwt_identity()
    resume = Resume.query.filter_by(id=resume_id, user_id=user_id).first()
    if not resume:
        return error_response("Resume not found.", 404)

    data = request.get_json(silent=True) or {}

    if "title" in data:
        resume.title = (data["title"] or resume.title).strip()
    if "template_id" in data:
        if data["template_id"] not in AVAILABLE_TEMPLATES:
            return error_response(
                f"Unknown template_id. Choose one of: {list(AVAILABLE_TEMPLATES.keys())}"
            )
        resume.template_id = data["template_id"]
    if "content" in data:
        resume.set_content(data["content"])
    else:
        content = resume.get_content(include_photo=True)
        for field in [
            "summary",
            "education",
            "experience",
            "projects",
            "skills",
            "certifications",
        ]:
            if field in data:
                content[field] = data[field]

        resume.set_content(content)
    if "target_job_title" in data:
        resume.target_job_title = data["target_job_title"]
    if "target_job_description" in data:
        resume.target_job_description = data["target_job_description"]

    db.session.commit()
    return success_response({"resume": resume.to_dict()}, message="Resume updated.")


@resume_bp.route("/<resume_id>", methods=["DELETE"])
@jwt_required()
def delete_resume(resume_id):
    user_id = get_jwt_identity()
    resume = Resume.query.filter_by(id=resume_id, user_id=user_id).first()
    if not resume:
        return error_response("Resume not found.", 404)

    db.session.delete(resume)
    db.session.commit()
    return success_response(message="Resume deleted.")
