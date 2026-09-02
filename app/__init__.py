import os
from flask import Flask, jsonify, send_from_directory, request
from flask_jwt_extended.exceptions import JWTExtendedException

from config import config_by_name
from app.extensions import db, jwt, bcrypt, cors, limiter


def create_app(config_name=None):
    config_name = config_name or os.getenv("FLASK_ENV", "development")
    frontend_folder = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
    )
    
    app = Flask(
        __name__,
        instance_relative_config=True,
        static_folder=frontend_folder,
        static_url_path="",
    )
    app.config.from_object(config_by_name.get(config_name, config_by_name["development"]))

    os.makedirs(app.instance_path, exist_ok=True)

    # --- Init extensions ---
    db.init_app(app)
    jwt.init_app(app)
    bcrypt.init_app(app)

    # Configure CORS
    client_urls = app.config.get("CLIENT_URL", "*")
    if client_urls == "*" or not client_urls:
        cors_origins = "*"
    else:
        cors_origins = [u.strip() for u in client_urls.split(",") if u.strip()]
    cors.init_app(app, resources={r"/api/*": {"origins": cors_origins}})
    limiter.init_app(app)

    # --- Register blueprints ---
    from app.routes.auth_routes import auth_bp
    from app.routes.resume_routes import resume_bp
    from app.routes.ai_routes import ai_bp
    from app.routes.ats_routes import ats_bp
    from app.routes.pdf_routes import pdf_bp
    from app.routes.templates_routes import templates_bp, billing_bp
    from app.routes.profile_routes import profile_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(resume_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(ats_bp)
    app.register_blueprint(pdf_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(profile_bp)

    # --- Health check ---
    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"success": True, "status": "ok", "service": "ai-resume-builder-backend"})

    # --- Frontend Static Serving ---
    @app.route("/", methods=["GET"])
    def serve_frontend():
        if os.path.exists(os.path.join(frontend_folder, "index.html")):
            return send_from_directory(frontend_folder, "index.html")
        return jsonify({"success": True, "message": "Backend API running. Frontend folder not found."})

    @app.route("/<path:path>", methods=["GET"])
    def serve_static(path):
        # Don't intercept API paths
        if path.startswith("api/"):
            return jsonify({"success": False, "error": "API route not found."}), 404
        file_path = os.path.join(frontend_folder, path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return send_from_directory(frontend_folder, path)
        if os.path.exists(os.path.join(frontend_folder, "index.html")):
            return send_from_directory(frontend_folder, "index.html")
        return jsonify({"success": False, "error": "Resource not found."}), 404

    # --- Error handlers ---
    @app.errorhandler(404)
    def not_found(e):
        if request.path.startswith("/api/"):
            return jsonify({"success": False, "error": "API route not found."}), 404
        if os.path.exists(os.path.join(frontend_folder, "index.html")):
            return send_from_directory(frontend_folder, "index.html")
        return jsonify({"success": False, "error": "Resource not found."}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"success": False, "error": "Method not allowed."}), 405

    @app.errorhandler(JWTExtendedException)
    def jwt_error(e):
        return jsonify({"success": False, "error": f"Auth error: {str(e)}"}), 401

    @app.errorhandler(429)
    def rate_limited(e):
        return jsonify({"success": False, "error": "Too many requests. Please slow down."}), 429

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"success": False, "error": "Internal server error."}), 500

    # --- Create tables (fine for SQLite/dev; use Alembic migrations in prod) ---
    with app.app_context():
        db.create_all()

    return app
