import json
import uuid
from datetime import datetime
from app.extensions import db


def gen_uuid():
    return str(uuid.uuid4())


class Resume(db.Model):
    __tablename__ = "resumes"

    id = db.Column(db.String(36), primary_key=True, default=gen_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    title = db.Column(db.String(150), nullable=False, default="Untitled Resume")
    template_id = db.Column(db.String(50), nullable=False, default="minimal")

    # Structured resume content stored as JSON text:
    # { personal: {...}, summary: "", experience: [...], education: [...],
    #   skills: [...], projects: [...], certifications: [...] }
    content_json = db.Column(db.Text, nullable=False, default="{}")

    ats_score = db.Column(db.Integer, nullable=True)
    ats_feedback_json = db.Column(db.Text, nullable=True)

    target_job_title = db.Column(db.String(150), nullable=True)
    target_job_description = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def get_content(self, include_photo=False):
        """Resume content dict.

        The profile photo (a base64 data-URI stored under content["photo"]) is
        left out by default so it never leaks into ATS scoring or AI prompts.
        Pass include_photo=True for the editor, PDF export and re-saving.
        """
        try:
            content = json.loads(self.content_json or "{}")
        except json.JSONDecodeError:
            return {}
        if not include_photo and isinstance(content, dict):
            content.pop("photo", None)
        return content

    def set_content(self, content: dict):
        # Accept only a reasonably small image data-URI as the photo; drop anything else.
        if isinstance(content, dict) and "photo" in content:
            photo = content.get("photo")
            if not (isinstance(photo, str) and photo.startswith("data:image/") and len(photo) <= 600_000):
                content = {k: v for k, v in content.items() if k != "photo"}
        self.content_json = json.dumps(content)

    def get_ats_feedback(self):
        if not self.ats_feedback_json:
            return None
        try:
            return json.loads(self.ats_feedback_json)
        except json.JSONDecodeError:
            return None

    def set_ats_feedback(self, feedback: dict):
        self.ats_feedback_json = json.dumps(feedback)

    def to_dict(self, include_content=True):
        data = {
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "template_id": self.template_id,
            "ats_score": self.ats_score,
            "ats_feedback": self.get_ats_feedback(),
            "target_job_title": self.target_job_title,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_content:
            data["content"] = self.get_content(include_photo=True)
        return data
