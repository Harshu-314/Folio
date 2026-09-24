from flask import Blueprint, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
import io

from app.models import Resume
from app.services.pdf_service import generate_resume_pdf
from app.utils import error_response

pdf_bp = Blueprint("pdf", __name__, url_prefix="/api/pdf")


@pdf_bp.route("/download/<resume_id>", methods=["GET"])
@jwt_required()
def download_resume_pdf(resume_id):
    """
    Free PDF downloads for everyone, per the PRD's competitive-advantage point.
    No plan check here on purpose - this stays free regardless of tier.
    """
    user_id = get_jwt_identity()
    resume = Resume.query.filter_by(id=resume_id, user_id=user_id).first()
    if not resume:
        return error_response("Resume not found.", 404)

    pdf_bytes = generate_resume_pdf(resume.get_content(include_photo=True), resume.template_id)
    filename = f"{(resume.title or 'resume').strip().replace(' ', '_')}.pdf"

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
