"""
PDF generation service. Renders resume/CV JSON content into a downloadable PDF.

Templates are built from a small set of real structural LAYOUT ENGINES
(single-column, left-sidebar, right-sidebar, timeline, banner-header),
each parameterized by accent color / font / section styling. This keeps
25 distinct, genuinely different-looking templates in one consistent,
maintainable system instead of 25 one-off renderers.

Two document families:
  - "resume" templates: fixed content sections (summary, experience,
    projects, education, skills, certifications). Single-column layouts
    stay ATS-friendly on purpose (ATS parsers choke on multi-column /
    graphic-heavy resumes) -- sidebar/banner layouts trade a little of
    that for visual style, which is fine for a resume a human will read.
  - "cv" templates: everything a resume has, PLUS the long-form academic
    sections a CV needs (publications, research experience, teaching
    experience, conferences, grants & fellowships, awards & honors,
    professional affiliations, references). CVs are allowed to run long
    -- no length nudging.
"""
import io
from fpdf import FPDF

PAGE_W = 210  # A4 mm
MARGIN = 18

# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------
# layout: which layout engine renders this template
# category: "resume" | "cv"
# accent: RGB tuple used for headings / rules / sidebar fill
# font: base font family passed to fpdf ("Helvetica" | "Times" | "Courier")
# title_style: "underline" | "boxed" | "plain"  (section title decoration)
# header_align: "left" | "center"  (name/header alignment, single/timeline layouts)

AVAILABLE_TEMPLATES = {
    # ---------------- 10 STRUCTURAL PREMIUM TEMPLATES 👑 ----------------
    "modern-pro": {
        "label": "Modern Professional", "category": "resume", "layout": "sidebar_left",
        "accent": (194, 65, 12), "font": "Helvetica", "title_style": "plain", "header_align": "left", "is_premium": True,
        "description": "Clean two-column layout with left contact/skills sidebar and main area."
    },
    "corporate-exec": {
        "label": "Corporate Executive", "category": "resume", "layout": "single",
        "accent": (30, 41, 59), "font": "Times", "title_style": "boxed", "header_align": "center", "is_premium": True,
        "description": "Single-column corporate layout with executive serif typography."
    },
    "modern-photo": {
        "label": "Modern Photo Resume", "category": "resume", "layout": "photo_header",
        "accent": (37, 99, 235), "font": "Helvetica", "title_style": "underline", "header_align": "left", "is_premium": True, "supports_photo": True,
        "description": "Prominent profile photo, header title, skills column & experience."
    },
    "tech-dev": {
        "label": "Technical Developer", "category": "resume", "layout": "tech_dev",
        "accent": (5, 150, 105), "font": "Courier", "title_style": "plain", "header_align": "left", "is_premium": True,
        "description": "Optimized for software/AI students. Tech stack & projects prioritized."
    },
    "creative-pro": {
        "label": "Creative Professional", "category": "resume", "layout": "creative_pro",
        "accent": (124, 58, 237), "font": "Helvetica", "title_style": "underline", "header_align": "left", "is_premium": True, "supports_photo": True,
        "description": "Modern visual hierarchy, elegant section styling and accent branding."
    },
    "academic-cv-pro": {
        "label": "Academic / CV", "category": "cv", "layout": "single",
        "accent": (67, 56, 202), "font": "Times", "title_style": "underline", "header_align": "left", "is_premium": True,
        "description": "Designed for research, education, publications, and certifications."
    },
    "minimal-ats-pro": {
        "label": "Minimal ATS Professional", "category": "resume", "layout": "compact",
        "accent": (15, 23, 42), "font": "Helvetica", "title_style": "plain", "header_align": "left", "is_premium": True,
        "description": "Ultra-clean single column with high ATS parsing accuracy."
    },
    "elegant-two-col": {
        "label": "Elegant Two Column", "category": "resume", "layout": "sidebar_right",
        "accent": (180, 83, 9), "font": "Times", "title_style": "plain", "header_align": "left", "is_premium": True,
        "description": "Balanced right sidebar with main content experience hierarchy."
    },
    "fresher-pro": {
        "label": "Fresher Professional", "category": "resume", "layout": "fresher_pro",
        "accent": (2, 132, 199), "font": "Helvetica", "title_style": "underline", "header_align": "left", "is_premium": True,
        "description": "B.Tech & college student layout emphasizing projects & education."
    },
    "executive-sidebar": {
        "label": "Executive Sidebar", "category": "resume", "layout": "executive_sidebar",
        "accent": (15, 23, 42), "font": "Helvetica", "title_style": "boxed", "header_align": "left", "is_premium": True, "supports_photo": True,
        "description": "Dark styled executive sidebar with photo frame & contact info."
    },

    # ---------------- STANDARD FREE RESUME (15) ----------------
    "minimal": {
        "label": "Minimal", "category": "resume", "layout": "single",
        "accent": (30, 30, 30), "font": "Helvetica", "title_style": "underline", "header_align": "left",
    },
    "modern": {
        "label": "Modern", "category": "resume", "layout": "single",
        "accent": (37, 99, 235), "font": "Helvetica", "title_style": "underline", "header_align": "left",
    },
    "classic": {
        "label": "Classic Serif", "category": "resume", "layout": "single",
        "accent": (60, 60, 60), "font": "Times", "title_style": "underline", "header_align": "left",
    },
    "sidebar-slate": {
        "label": "Sidebar - Slate", "category": "resume", "layout": "sidebar_left",
        "accent": (71, 85, 105), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "sidebar-emerald": {
        "label": "Sidebar - Emerald", "category": "resume", "layout": "sidebar_left",
        "accent": (5, 122, 85), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "sidebar-right-coral": {
        "label": "Sidebar - Coral (Right)", "category": "resume", "layout": "sidebar_right",
        "accent": (224, 82, 63), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "timeline-indigo": {
        "label": "Timeline - Indigo", "category": "resume", "layout": "timeline",
        "accent": (67, 56, 202), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "timeline-charcoal": {
        "label": "Timeline - Charcoal Serif", "category": "resume", "layout": "timeline",
        "accent": (55, 55, 55), "font": "Times", "title_style": "plain", "header_align": "left",
    },
    "compact-ats": {
        "label": "Compact ATS-Safe", "category": "resume", "layout": "compact",
        "accent": (0, 0, 0), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "banner-crimson": {
        "label": "Banner - Crimson", "category": "resume", "layout": "banner",
        "accent": (185, 28, 28), "font": "Helvetica", "title_style": "underline", "header_align": "left",
    },
    "banner-teal": {
        "label": "Banner - Teal", "category": "resume", "layout": "banner",
        "accent": (13, 118, 128), "font": "Helvetica", "title_style": "underline", "header_align": "left",
    },
    "executive-navy": {
        "label": "Executive Navy", "category": "resume", "layout": "single",
        "accent": (30, 41, 92), "font": "Times", "title_style": "boxed", "header_align": "center",
    },
    "bold-graphite": {
        "label": "Bold Graphite", "category": "resume", "layout": "single",
        "accent": (40, 40, 40), "font": "Helvetica", "title_style": "boxed", "header_align": "left",
    },
    "mono-tech": {
        "label": "Mono Tech", "category": "resume", "layout": "single",
        "accent": (22, 130, 90), "font": "Courier", "title_style": "plain", "header_align": "left",
    },
    "gradient-violet": {
        "label": "Gradient Violet", "category": "resume", "layout": "banner",
        "accent": (109, 40, 217), "font": "Helvetica", "title_style": "underline", "header_align": "left",
    },

    # ---------------- CV (10) ----------------
    "academic-classic": {
        "label": "Academic Classic", "category": "cv", "layout": "single",
        "accent": (20, 20, 20), "font": "Times", "title_style": "underline", "header_align": "center",
    },
    "academic-modern": {
        "label": "Academic Modern", "category": "cv", "layout": "single",
        "accent": (30, 64, 175), "font": "Helvetica", "title_style": "underline", "header_align": "left",
    },
    "research-focus": {
        "label": "Research-Focused", "category": "cv", "layout": "single",
        "accent": (76, 29, 149), "font": "Times", "title_style": "underline", "header_align": "left",
        "section_priority": ["publications", "research_experience"],
    },
    "medical-clinical": {
        "label": "Medical / Clinical CV", "category": "cv", "layout": "single",
        "accent": (13, 100, 100), "font": "Times", "title_style": "underline", "header_align": "left",
    },
    "europass-style": {
        "label": "Europass-Style", "category": "cv", "layout": "sidebar_left",
        "accent": (90, 90, 90), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "two-column-academic": {
        "label": "Two-Column Academic", "category": "cv", "layout": "sidebar_right",
        "accent": (120, 30, 40), "font": "Times", "title_style": "plain", "header_align": "left",
    },
    "minimalist-cv": {
        "label": "Minimalist CV", "category": "cv", "layout": "compact",
        "accent": (10, 10, 10), "font": "Helvetica", "title_style": "plain", "header_align": "left",
    },
    "grants-fellowship": {
        "label": "Grants & Fellowships", "category": "cv", "layout": "single",
        "accent": (161, 98, 7), "font": "Times", "title_style": "underline", "header_align": "left",
        "section_priority": ["grants_fellowships", "awards_honors"],
    },
    "teaching-focused": {
        "label": "Teaching-Focused", "category": "cv", "layout": "single",
        "accent": (21, 94, 60), "font": "Helvetica", "title_style": "underline", "header_align": "left",
        "section_priority": ["teaching_experience"],
    },
    "full-academic-longform": {
        "label": "Full Academic (Long-Form)", "category": "cv", "layout": "compact",
        "accent": (30, 41, 92), "font": "Times", "title_style": "plain", "header_align": "left",
    },
}

BASE_SECTIONS = ["summary", "experience", "projects", "education", "skills", "certifications"]

CV_SECTIONS = [
    ("publications", "Publications"),
    ("research_experience", "Research Experience"),
    ("teaching_experience", "Teaching Experience"),
    ("conferences", "Conferences & Presentations"),
    ("grants_fellowships", "Grants & Fellowships"),
    ("awards_honors", "Awards & Honors"),
    ("affiliations", "Professional Affiliations"),
    ("references", "References"),
]


def _safe(text):
    if text is None:
        return ""
    return str(text).encode("latin-1", "replace").decode("latin-1")


class ResumePDF(FPDF):
    def __init__(self, template):
        super().__init__(format="A4")
        self.template = template
        self.accent = template["accent"]
        self.font_family = template["font"]
        self.set_auto_page_break(auto=True, margin=15)
        self.set_margins(MARGIN, 15, MARGIN)
        # Optional hooks used by the premium designer layouts.
        self.page_decor = None            # callable(pdf) drawn at the start of every page
        self.title_style_override = None  # overrides template["title_style"] when set

    def header(self):
        if self.page_decor:
            self.page_decor(self)

    def section_title(self, title, x=None, width=None):
        style = self.title_style_override or self.template["title_style"]
        x = self.l_margin if x is None else x
        width = (PAGE_W - self.l_margin - self.r_margin) if width is None else width
        self.set_x(x)
        self.ln(3)
        self.set_font(self.font_family, "B", 11.5)
        if style == "boxed":
            self.set_fill_color(*self.accent)
            self.set_text_color(255, 255, 255)
            self.set_x(x)
            self.cell(width, 7, "  " + title.upper(), fill=True, ln=1)
            self.set_text_color(20, 20, 20)
        elif style == "code":
            self.set_text_color(*self.accent)
            self.set_x(x)
            self.cell(width, 6.5, "// " + title.lower(), ln=1)
            self.ln(1)
        else:
            self.set_text_color(*self.accent)
            self.set_x(x)
            self.cell(width, 6.5, title.upper(), ln=1)
            if style == "underline":
                self.set_draw_color(*self.accent)
                self.set_line_width(0.4)
                y = self.get_y()
                self.line(x, y, x + width, y)
            self.ln(1.5)
        self.set_text_color(20, 20, 20)
        self.set_x(x)


def _multi(pdf, h, text, x=None, width=None):
    x = pdf.l_margin if x is None else x
    pdf.set_x(x)
    if width:
        pdf.multi_cell(width, h, text, new_x="LEFT", new_y="NEXT")
        pdf.set_x(x)
    else:
        pdf.multi_cell(0, h, text, new_x="LMARGIN", new_y="NEXT")


def _bullet_list(pdf, items, x=None, width=None):
    for item in items or []:
        if not item:
            continue
        _multi(pdf, 5.2, _safe(f"- {item}"), x=x, width=width)


def _render_experience(pdf, content, x, width):
    if not content.get("experience"):
        return
    pdf.section_title("Experience", x=x, width=width)
    for exp in content["experience"]:
        pdf.set_font(pdf.font_family, "B", 10.5)
        pdf.set_x(x)
        pdf.multi_cell(width, 5.5, _safe(f"{exp.get('role','')} - {exp.get('company','')}"), new_x="LEFT", new_y="NEXT")
        pdf.set_font(pdf.font_family, "I", 9)
        pdf.set_text_color(90, 90, 90)
        pdf.set_x(x)
        pdf.cell(width, 5, _safe(exp.get("duration", "")), ln=1)
        pdf.set_text_color(20, 20, 20)
        pdf.set_font(pdf.font_family, "", 10)
        _bullet_list(pdf, exp.get("bullets", []), x=x, width=width)
        pdf.ln(1)


def _render_projects(pdf, content, x, width):
    if not content.get("projects"):
        return
    pdf.section_title("Projects", x=x, width=width)
    for proj in content["projects"]:
        pdf.set_font(pdf.font_family, "B", 10.5)
        pdf.set_x(x)
        pdf.multi_cell(width, 5.5, _safe(proj.get("name", "")), new_x="LEFT", new_y="NEXT")
        if proj.get("tech_stack"):
            pdf.set_font(pdf.font_family, "I", 9)
            pdf.set_text_color(90, 90, 90)
            pdf.set_x(x)
            pdf.multi_cell(width, 5, _safe(", ".join(proj["tech_stack"])), new_x="LEFT", new_y="NEXT")
            pdf.set_text_color(20, 20, 20)
        pdf.set_font(pdf.font_family, "", 10)
        if proj.get("description"):
            _multi(pdf, 5, _safe(proj["description"]), x=x, width=width)
        _bullet_list(pdf, proj.get("bullets", []), x=x, width=width)
        pdf.ln(1)


def _render_education(pdf, content, x, width):
    if not content.get("education"):
        return
    pdf.section_title("Education", x=x, width=width)
    for edu in content["education"]:
        pdf.set_font(pdf.font_family, "B", 10.5)
        pdf.set_x(x)
        pdf.multi_cell(width, 5.5, _safe(edu.get("degree", "")), new_x="LEFT", new_y="NEXT")
        pdf.set_font(pdf.font_family, "", 9.5)
        pdf.set_x(x)
        pdf.multi_cell(width, 5, _safe(f"{edu.get('institution','')} - {edu.get('duration','')}"), new_x="LEFT", new_y="NEXT")
        if edu.get("details"):
            _multi(pdf, 5, _safe(edu["details"]), x=x, width=width)
        pdf.ln(1)


def _render_skills(pdf, content, x, width):
    if not content.get("skills"):
        return
    pdf.section_title("Skills", x=x, width=width)
    pdf.set_font(pdf.font_family, "", 10)
    _multi(pdf, 5.2, _safe(", ".join(content["skills"])), x=x, width=width)


def _render_certifications(pdf, content, x, width):
    if not content.get("certifications"):
        return
    pdf.section_title("Certifications", x=x, width=width)
    pdf.set_font(pdf.font_family, "", 10)
    _bullet_list(pdf, content["certifications"], x=x, width=width)


def _render_summary(pdf, content, x, width):
    if not content.get("summary"):
        return
    pdf.section_title("Professional Summary", x=x, width=width)
    pdf.set_font(pdf.font_family, "", 10)
    _multi(pdf, 5.2, _safe(content["summary"]), x=x, width=width)


def _render_cv_list_section(pdf, content, key, title, x, width):
    items = content.get(key)
    if not items:
        return
    pdf.section_title(title, x=x, width=width)
    pdf.set_font(pdf.font_family, "", 10)
    for item in items:
        if isinstance(item, str):
            _multi(pdf, 5.2, _safe(f"- {item}"), x=x, width=width)
        elif isinstance(item, dict):
            main = item.get("title") or item.get("name") or ""
            sub = item.get("detail") or item.get("description") or ""
            duration = item.get("duration") or item.get("year") or ""
            pdf.set_font(pdf.font_family, "B", 10)
            pdf.set_x(x)
            line = _safe(main) + (f"  ({_safe(duration)})" if duration else "")
            pdf.multi_cell(width, 5.2, line, new_x="LEFT", new_y="NEXT")
            if sub:
                pdf.set_font(pdf.font_family, "", 9.5)
                _multi(pdf, 5, _safe(sub), x=x, width=width)
    pdf.ln(1)


SECTION_RENDERERS = {
    "summary": _render_summary,
    "experience": _render_experience,
    "projects": _render_projects,
    "education": _render_education,
    "skills": _render_skills,
    "certifications": _render_certifications,
}


def _ordered_sections(template):
    priority = template.get("section_priority", [])
    cv_sections = [key for key, _ in CV_SECTIONS]
    ordered_priority = [s for s in priority if s in cv_sections]
    remaining_cv = [key for key, _ in CV_SECTIONS if key not in ordered_priority]
    return ordered_priority, remaining_cv


def _render_header(pdf, content, template, x, width, name_size=19):
    personal = content.get("personal", {})
    align = template.get("header_align", "left")
    pdf.set_font(pdf.font_family, "B", name_size)
    pdf.set_text_color(*template["accent"])
    pdf.set_x(x)
    if align == "center":
        pdf.cell(width, 9, _safe(personal.get("name", "Your Name")), ln=1, align="C")
    else:
        pdf.cell(width, 9, _safe(personal.get("name", "Your Name")), ln=1)

    contact_bits = [
        personal.get("email"), personal.get("phone"), personal.get("location"),
        personal.get("linkedin"), personal.get("portfolio"),
    ]
    contact_line = "  |  ".join(_safe(b) for b in contact_bits if b)
    pdf.set_font(pdf.font_family, "", 9.5)
    pdf.set_text_color(80, 80, 80)
    pdf.set_x(x)
    if align == "center":
        pdf.multi_cell(width, 5.5, contact_line, align="C", new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.multi_cell(width, 5.5, contact_line, new_x="LEFT", new_y="NEXT")
    pdf.set_text_color(20, 20, 20)


def _render_body_sections(pdf, content, template, x, width, include_base=None, include_cv=None):
    base = include_base if include_base is not None else BASE_SECTIONS
    for key in base:
        SECTION_RENDERERS[key](pdf, content, x, width)

    priority, remaining = _ordered_sections(template)
    cv_titles = dict(CV_SECTIONS)
    cv_keys = priority + remaining if include_cv is None else include_cv
    for key in cv_keys:
        _render_cv_list_section(pdf, content, key, cv_titles[key], x, width)


def _layout_single(pdf, content, template):
    full_w = PAGE_W - MARGIN - MARGIN
    pdf.add_page()
    _render_header(pdf, content, template, MARGIN, full_w)
    _render_body_sections(pdf, content, template, MARGIN, full_w)


def _layout_compact(pdf, content, template):
    full_w = PAGE_W - MARGIN - MARGIN
    pdf.add_page()
    _render_header(pdf, content, template, MARGIN, full_w, name_size=16)
    pdf.ln(0.5)
    _render_body_sections(pdf, content, template, MARGIN, full_w)


def _layout_banner(pdf, content, template):
    full_w = PAGE_W - MARGIN - MARGIN
    pdf.add_page()
    pdf.set_fill_color(*template["accent"])
    pdf.rect(0, 0, PAGE_W, 32, style="F")
    personal = content.get("personal", {})
    pdf.set_xy(MARGIN, 9)
    pdf.set_font(template["font"], "B", 20)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(full_w, 10, _safe(personal.get("name", "Your Name")), ln=1)
    contact_bits = [personal.get("email"), personal.get("phone"), personal.get("location"),
                    personal.get("linkedin"), personal.get("portfolio")]
    contact_line = "  |  ".join(_safe(b) for b in contact_bits if b)
    pdf.set_x(MARGIN)
    pdf.set_font(template["font"], "", 9.5)
    pdf.cell(full_w, 6, contact_line, ln=1)
    pdf.set_text_color(20, 20, 20)
    pdf.set_y(38)
    _render_body_sections(pdf, content, template, MARGIN, full_w)


def _layout_timeline(pdf, content, template):
    full_w = PAGE_W - MARGIN - MARGIN
    pdf.add_page()
    _render_header(pdf, content, template, MARGIN, full_w)
    _render_summary(pdf, content, MARGIN, full_w)

    def draw_rule_then(fn, *args):
        y_start = pdf.get_y()
        fn(*args)
        y_end = pdf.get_y()
        if y_end > y_start + 2:
            pdf.set_draw_color(*template["accent"])
            pdf.set_line_width(0.8)
            pdf.line(MARGIN - 4, y_start + 6, MARGIN - 4, y_end - 1)

    draw_rule_then(_render_experience, pdf, content, MARGIN, full_w)
    draw_rule_then(_render_projects, pdf, content, MARGIN, full_w)
    _render_education(pdf, content, MARGIN, full_w)
    _render_skills(pdf, content, MARGIN, full_w)
    _render_certifications(pdf, content, MARGIN, full_w)

    priority, remaining = _ordered_sections(template)
    cv_titles = dict(CV_SECTIONS)
    for key in priority + remaining:
        _render_cv_list_section(pdf, content, key, cv_titles[key], MARGIN, full_w)


def _sidebar_columns(side):
    gap = 6
    side_w = 62
    main_w = PAGE_W - MARGIN - MARGIN - side_w - gap
    if side == "left":
        side_x = MARGIN
        main_x = MARGIN + side_w + gap
    else:
        main_x = MARGIN
        side_x = MARGIN + main_w + gap
    return side_x, side_w, main_x, main_w


def _layout_sidebar(pdf, content, template, side):
    side_x, side_w, main_x, main_w = _sidebar_columns(side)
    pdf.add_page()

    band_x = 0 if side == "left" else PAGE_W - side_w - MARGIN
    band_w = side_w + MARGIN
    pdf.set_fill_color(*template["accent"])
    pdf.rect(band_x, 0, band_w, 297, style="F")

    pdf.set_xy(side_x, 15)
    personal = content.get("personal", {})
    pdf.set_text_color(255, 255, 255)
    pdf.set_font(template["font"], "B", 15)
    pdf.set_x(side_x)
    pdf.multi_cell(side_w, 6.5, _safe(personal.get("name", "Your Name")), new_x="LEFT", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font(template["font"], "", 8.5)
    for bit in [personal.get("email"), personal.get("phone"), personal.get("location"),
                personal.get("linkedin"), personal.get("portfolio")]:
        if bit:
            pdf.set_x(side_x)
            pdf.multi_cell(side_w, 4.6, _safe(bit), new_x="LEFT", new_y="NEXT")
    pdf.ln(3)

    def side_title(t):
        pdf.set_x(side_x)
        pdf.set_font(template["font"], "B", 10)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(side_w, 6, t.upper(), ln=1)
        pdf.set_font(template["font"], "", 9)

    if content.get("skills"):
        side_title("Skills")
        pdf.set_x(side_x)
        pdf.multi_cell(side_w, 4.8, _safe(", ".join(content["skills"])), new_x="LEFT", new_y="NEXT")
        pdf.ln(2)

    if content.get("education"):
        side_title("Education")
        for edu in content["education"]:
            pdf.set_x(side_x)
            pdf.set_font(template["font"], "B", 9)
            pdf.multi_cell(side_w, 4.6, _safe(edu.get("degree", "")), new_x="LEFT", new_y="NEXT")
            pdf.set_x(side_x)
            pdf.set_font(template["font"], "", 8.5)
            pdf.multi_cell(side_w, 4.4, _safe(f"{edu.get('institution','')}  {edu.get('duration','')}"), new_x="LEFT", new_y="NEXT")
            pdf.ln(1)

    if content.get("certifications"):
        side_title("Certifications")
        for cert in content["certifications"]:
            pdf.set_x(side_x)
            pdf.multi_cell(side_w, 4.6, _safe(f"- {cert}"), new_x="LEFT", new_y="NEXT")

    if content.get("affiliations"):
        side_title("Affiliations")
        for aff in content["affiliations"]:
            txt = aff if isinstance(aff, str) else (aff.get("title") or aff.get("name") or "")
            pdf.set_x(side_x)
            pdf.multi_cell(side_w, 4.6, _safe(f"- {txt}"), new_x="LEFT", new_y="NEXT")

    pdf.set_xy(main_x, 15)
    pdf.set_text_color(20, 20, 20)
    _render_summary(pdf, content, main_x, main_w)
    _render_experience(pdf, content, main_x, main_w)
    _render_projects(pdf, content, main_x, main_w)

    priority, remaining = _ordered_sections(template)
    cv_titles = dict(CV_SECTIONS)
    skip = {"affiliations"}
    for key in priority + remaining:
        if key in skip:
            continue
        _render_cv_list_section(pdf, content, key, cv_titles[key], main_x, main_w)


# ---------------------------------------------------------------------------
# Premium designer layouts (photo header, creative, executive, fresher, tech)
# ---------------------------------------------------------------------------
def _tint(rgb, t):
    """Blend an RGB colour towards white by t (0..1)."""
    return tuple(int(c + (255 - c) * t) for c in rgb)


def _contact_list(personal):
    return [str(b) for b in (
        personal.get("email"), personal.get("phone"), personal.get("location"),
        personal.get("linkedin"), personal.get("portfolio"),
    ) if b]


def _photo_png(content, px=320):
    """Decode content['photo'] (data-URI) into a circular-cropped PNG buffer, or None."""
    raw = (content or {}).get("photo")
    if not isinstance(raw, str) or not raw.startswith("data:image/") or "," not in raw:
        return None
    try:
        import base64
        import io
        from PIL import Image, ImageDraw

        img = Image.open(io.BytesIO(base64.b64decode(raw.split(",", 1)[1]))).convert("RGB")
        w, h = img.size
        side = min(w, h)
        left, top = (w - side) // 2, (h - side) // 4  # bias crop upward so faces stay in frame
        img = img.crop((left, top, left + side, top + side)).resize((px, px), Image.LANCZOS)
        mask = Image.new("L", (px * 4, px * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
        img.putalpha(mask.resize((px, px), Image.LANCZOS))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf
    except Exception:
        return None  # a bad/corrupt photo must never break PDF generation


def _draw_photo(pdf, content, x, y, d, template, ring=(255, 255, 255),
                fallback_fill=None, initials_rgb=None):
    """Circular profile photo; falls back to an initials disc when no photo is set."""
    buf = _photo_png(content)
    if buf is not None:
        pdf.image(buf, x=x, y=y, w=d, h=d)
    else:
        pdf.set_fill_color(*(fallback_fill or _tint(template["accent"], 0.8)))
        pdf.ellipse(x, y, d, d, style="F")
        name = (content.get("personal") or {}).get("name") or ""
        initials = "".join(part[0] for part in name.split()[:2]).upper() or "?"
        pdf.set_font(template["font"], "B", d * 0.55)
        pdf.set_text_color(*(initials_rgb or template["accent"]))
        pdf.set_xy(x, y + d * 0.3)
        pdf.cell(d, d * 0.4, _safe(initials), align="C")
    pdf.set_draw_color(*ring)
    pdf.set_line_width(0.9)
    pdf.ellipse(x, y, d, d, style="D")
    pdf.set_text_color(20, 20, 20)


def _chips(pdf, items, x, width, fill, text_rgb, size=8, h=5.6):
    """Flowing rounded 'pill' tags (used for skills)."""
    items = [str(i) for i in (items or []) if i]
    pdf.set_font(pdf.font_family, "B", size)
    cx, cy = x, pdf.get_y()
    for item in items:
        label = _safe(item)
        while len(label) > 1 and pdf.get_string_width(label) + 5 > width:
            label = label[:-1]
        w = pdf.get_string_width(label) + 5
        if cx + w > x + width + 0.01:
            cx, cy = x, cy + h + 1.6
        pdf.set_fill_color(*fill)
        pdf.rect(cx, cy, w, h, style="F", round_corners=True, corner_radius=h / 2)
        pdf.set_text_color(*text_rgb)
        pdf.set_xy(cx, cy)
        pdf.cell(w, h, label, align="C")
        cx += w + 1.6
    pdf.set_xy(x, cy + h + 2)
    pdf.set_text_color(20, 20, 20)


def _panel_sections(pdf, content, template, x, w, title_rgb, text_rgb, muted_rgb,
                    chip_fill, chip_text):
    """Skills / Education / Certifications / Affiliations stacked in a narrow column."""
    font = template["font"]

    def title(t):
        pdf.set_xy(x, pdf.get_y() + 2)
        pdf.set_font(font, "B", 9.5)
        pdf.set_text_color(*title_rgb)
        pdf.cell(w, 5.5, t.upper(), new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(*title_rgb)
        pdf.set_line_width(0.3)
        y = pdf.get_y()
        pdf.line(x, y, x + w, y)
        pdf.set_y(y + 2)

    if content.get("skills"):
        title("Skills")
        _chips(pdf, content["skills"], x, w, chip_fill, chip_text)

    if content.get("education"):
        title("Education")
        for edu in content["education"]:
            pdf.set_font(font, "B", 9)
            pdf.set_text_color(*text_rgb)
            pdf.set_x(x)
            pdf.multi_cell(w, 4.6, _safe(edu.get("degree", "")), new_x="LEFT", new_y="NEXT")
            pdf.set_font(font, "", 8.5)
            pdf.set_text_color(*muted_rgb)
            pdf.set_x(x)
            pdf.multi_cell(w, 4.4, _safe(f"{edu.get('institution', '')}  {edu.get('duration', '')}".strip()),
                           new_x="LEFT", new_y="NEXT")
            pdf.ln(1.5)

    for key, label in (("certifications", "Certifications"), ("affiliations", "Affiliations")):
        entries = content.get(key)
        if not entries:
            continue
        title(label)
        pdf.set_font(font, "", 8.5)
        pdf.set_text_color(*text_rgb)
        for entry in entries:
            txt = entry if isinstance(entry, str) else (entry.get("title") or entry.get("name") or "")
            _multi(pdf, 4.6, _safe(f"- {txt}"), x=x, width=w)
    pdf.set_text_color(20, 20, 20)


def _render_main_column(pdf, content, template, x, w, base=("summary", "experience", "projects")):
    for key in base:
        SECTION_RENDERERS[key](pdf, content, x, w)
    priority, remaining = _ordered_sections(template)
    titles = dict(CV_SECTIONS)
    for key in priority + remaining:
        if key == "affiliations":  # shown in the side panel
            continue
        _render_cv_list_section(pdf, content, key, titles[key], x, w)


def _layout_photo_header(pdf, content, template):
    """Photo + name header, tinted left column (skills/education), main column right."""
    acc = template["accent"]
    personal = content.get("personal", {})
    d = 34
    side_w, gap = 50, 10
    main_x = MARGIN + side_w + gap
    main_w = PAGE_W - main_x - MARGIN
    panel_w = MARGIN + side_w + 5
    tint = _tint(acc, 0.92)

    def decor(p):  # continuation pages get the full-height tinted column
        if p.page_no() > 1:
            p.set_fill_color(*tint)
            p.rect(0, 0, panel_w, 297, style="F")

    pdf.page_decor = decor
    pdf.add_page()
    _draw_photo(pdf, content, MARGIN, 12, d, template, ring=acc)

    tx = MARGIN + d + 8
    tw = PAGE_W - tx - MARGIN
    pdf.set_xy(tx, 14)
    pdf.set_font(template["font"], "B", 22)
    pdf.set_text_color(*acc)
    pdf.multi_cell(tw, 9.5, _safe(personal.get("name", "Your Name")), new_x="LEFT", new_y="NEXT")
    role = personal.get("headline") or personal.get("title")
    if role:
        pdf.set_x(tx)
        pdf.set_font(template["font"], "", 11)
        pdf.set_text_color(60, 60, 60)
        pdf.multi_cell(tw, 6, _safe(role), new_x="LEFT", new_y="NEXT")
    pdf.set_font(template["font"], "", 9)
    pdf.set_text_color(90, 90, 90)
    for bit in _contact_list(personal):
        pdf.set_x(tx)
        pdf.multi_cell(tw, 4.8, _safe(bit), new_x="LEFT", new_y="NEXT")

    rule_y = max(pdf.get_y(), 12 + d) + 3
    pdf.set_draw_color(*acc)
    pdf.set_line_width(0.9)
    pdf.line(MARGIN, rule_y, PAGE_W - MARGIN, rule_y)
    body_top = rule_y + 4
    pdf.set_fill_color(*tint)
    pdf.rect(0, body_top, panel_w, 297 - body_top, style="F")

    pdf.set_y(body_top)
    _panel_sections(pdf, content, template, MARGIN, side_w, title_rgb=acc, text_rgb=(30, 30, 30),
                    muted_rgb=(90, 90, 90), chip_fill=(255, 255, 255), chip_text=acc)
    pdf.set_xy(main_x, body_top - 2)
    _render_main_column(pdf, content, template, main_x, main_w)


def _layout_creative_pro(pdf, content, template):
    """Full-width colour banner with photo, main column left, tinted panel right."""
    acc = template["accent"]
    personal = content.get("personal", {})
    band_h, d = 50, 34
    side_w, gap = 52, 8
    main_x = MARGIN
    main_w = PAGE_W - 2 * MARGIN - side_w - gap
    side_x = main_x + main_w + gap
    panel_x = side_x - 5
    tint = _tint(acc, 0.93)

    def decor(p):
        if p.page_no() > 1:
            p.set_fill_color(*tint)
            p.rect(panel_x, 0, PAGE_W - panel_x, 297, style="F")

    pdf.page_decor = decor
    pdf.add_page()
    pdf.set_fill_color(*acc)
    pdf.rect(0, 0, PAGE_W, band_h, style="F")
    pdf.set_fill_color(*tint)
    pdf.rect(panel_x, band_h, PAGE_W - panel_x, 297 - band_h, style="F")
    _draw_photo(pdf, content, PAGE_W - MARGIN - d, 8, d, template, ring=(255, 255, 255),
                fallback_fill=_tint(acc, 0.85))

    tw = PAGE_W - 2 * MARGIN - d - 6
    pdf.set_xy(MARGIN, 12)
    pdf.set_font(template["font"], "B", 22)
    pdf.set_text_color(255, 255, 255)
    pdf.multi_cell(tw, 9.5, _safe(personal.get("name", "Your Name")), new_x="LEFT", new_y="NEXT")
    pdf.ln(1)
    pdf.set_x(MARGIN)
    pdf.set_font(template["font"], "", 9)
    pdf.set_text_color(*_tint(acc, 0.85))
    pdf.multi_cell(tw, 4.8, _safe("  |  ".join(_contact_list(personal))), align="L", new_x="LEFT", new_y="NEXT")

    pdf.set_y(band_h + 2)
    _panel_sections(pdf, content, template, side_x, side_w, title_rgb=acc, text_rgb=(30, 30, 30),
                    muted_rgb=(90, 90, 90), chip_fill=(255, 255, 255), chip_text=acc)
    pdf.set_xy(main_x, band_h - 2)
    _render_main_column(pdf, content, template, main_x, main_w)


def _layout_executive_sidebar(pdf, content, template):
    """Dark full-height left panel with photo, coral accents, main column right."""
    navy = template["accent"]
    coral = (240, 108, 88)
    personal = content.get("personal", {})
    panel_w, pad, d = 70, 9, 38
    side_x, side_w = pad, panel_w - 2 * pad
    main_x = panel_w + 10
    main_w = PAGE_W - main_x - 14

    def decor(p):
        p.set_fill_color(*navy)
        p.rect(0, 0, panel_w, 297, style="F")

    pdf.page_decor = decor
    pdf.add_page()
    _draw_photo(pdf, content, (panel_w - d) / 2, 14, d, template, ring=coral,
                fallback_fill=(51, 65, 85), initials_rgb=(255, 255, 255))

    pdf.set_xy(side_x, 14 + d + 6)
    pdf.set_font(template["font"], "B", 14)
    pdf.set_text_color(255, 255, 255)
    pdf.multi_cell(side_w, 6.5, _safe(personal.get("name", "Your Name")), align="C",
                   new_x="LEFT", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font(template["font"], "", 8)
    pdf.set_text_color(203, 213, 225)
    for bit in _contact_list(personal):
        pdf.set_x(side_x)
        pdf.multi_cell(side_w, 4.4, _safe(bit), align="C", new_x="LEFT", new_y="NEXT")

    _panel_sections(pdf, content, template, side_x, side_w, title_rgb=coral, text_rgb=(255, 255, 255),
                    muted_rgb=(203, 213, 225), chip_fill=coral, chip_text=(255, 255, 255))
    pdf.set_xy(main_x, 13)
    _render_main_column(pdf, content, template, main_x, main_w)


def _layout_fresher_pro(pdf, content, template):
    """Fresher-friendly: photo header band, boxed section bars, education & projects first."""
    acc = template["accent"]
    personal = content.get("personal", {})
    full_w = PAGE_W - 2 * MARGIN
    band_h, d = 46, 32
    pdf.add_page()
    pdf.set_fill_color(*_tint(acc, 0.88))
    pdf.rect(0, 0, PAGE_W, band_h, style="F")
    pdf.set_fill_color(*acc)
    pdf.rect(0, band_h, PAGE_W, 1.6, style="F")
    _draw_photo(pdf, content, PAGE_W - MARGIN - d, 7, d, template, ring=(255, 255, 255))

    tw = full_w - d - 6
    pdf.set_xy(MARGIN, 11)
    pdf.set_font(template["font"], "B", 22)
    pdf.set_text_color(*acc)
    pdf.multi_cell(tw, 9.5, _safe(personal.get("name", "Your Name")), new_x="LEFT", new_y="NEXT")
    pdf.ln(1)
    pdf.set_x(MARGIN)
    pdf.set_font(template["font"], "", 9)
    pdf.set_text_color(70, 70, 70)
    pdf.multi_cell(tw, 4.8, _safe("  |  ".join(_contact_list(personal))), align="L", new_x="LEFT", new_y="NEXT")

    pdf.set_y(band_h + 4)
    pdf.title_style_override = "boxed"
    for key in ("summary", "education", "projects"):
        SECTION_RENDERERS[key](pdf, content, MARGIN, full_w)
    if content.get("skills"):
        pdf.section_title("Skills", x=MARGIN, width=full_w)
        pdf.ln(1)
        _chips(pdf, content["skills"], MARGIN, full_w, _tint(acc, 0.85), acc)
    _render_experience(pdf, content, MARGIN, full_w)
    _render_certifications(pdf, content, MARGIN, full_w)
    priority, remaining = _ordered_sections(template)
    titles = dict(CV_SECTIONS)
    for key in priority + remaining:
        _render_cv_list_section(pdf, content, key, titles[key], MARGIN, full_w)


def _layout_tech_dev(pdf, content, template):
    """Developer look: dark terminal header, monospace, '// section' titles, projects first."""
    acc = template["accent"]
    glow = (52, 211, 153)
    personal = content.get("personal", {})
    full_w = PAGE_W - 2 * MARGIN
    pdf.add_page()
    pdf.set_fill_color(17, 24, 39)
    pdf.rect(0, 0, PAGE_W, 40, style="F")

    name = _safe(personal.get("name", "Your Name"))
    pdf.set_xy(MARGIN, 11)
    pdf.set_font("Courier", "B", 18 if len(name) <= 30 else 13)
    pdf.set_text_color(*glow)
    prompt_w = pdf.get_string_width("> ")
    pdf.cell(prompt_w, 9, "> ")
    pdf.set_text_color(255, 255, 255)
    pdf.cell(full_w - prompt_w, 9, name, new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(MARGIN)
    pdf.set_font("Courier", "", 8.5)
    pdf.set_text_color(156, 163, 175)
    pdf.multi_cell(full_w, 4.8, _safe("  |  ".join(_contact_list(personal))), align="L", new_x="LEFT", new_y="NEXT")

    pdf.set_y(46)
    pdf.title_style_override = "code"
    _render_summary(pdf, content, MARGIN, full_w)
    if content.get("skills"):
        pdf.section_title("Skills", x=MARGIN, width=full_w)
        _chips(pdf, content["skills"], MARGIN, full_w, _tint(acc, 0.88), (6, 95, 70))
    _render_projects(pdf, content, MARGIN, full_w)
    _render_experience(pdf, content, MARGIN, full_w)
    _render_education(pdf, content, MARGIN, full_w)
    _render_certifications(pdf, content, MARGIN, full_w)
    priority, remaining = _ordered_sections(template)
    titles = dict(CV_SECTIONS)
    for key in priority + remaining:
        _render_cv_list_section(pdf, content, key, titles[key], MARGIN, full_w)


LAYOUT_ENGINES = {
    "single": _layout_single,
    "compact": _layout_compact,
    "banner": _layout_banner,
    "timeline": _layout_timeline,
    "sidebar_left": lambda pdf, content, template: _layout_sidebar(pdf, content, template, "left"),
    "sidebar_right": lambda pdf, content, template: _layout_sidebar(pdf, content, template, "right"),
    "photo_header": _layout_photo_header,
    "creative_pro": _layout_creative_pro,
    "executive_sidebar": _layout_executive_sidebar,
    "fresher_pro": _layout_fresher_pro,
    "tech_dev": _layout_tech_dev,
}


def generate_resume_pdf(content: dict, template_id: str = "minimal") -> bytes:
    template = AVAILABLE_TEMPLATES.get(template_id, AVAILABLE_TEMPLATES["minimal"])
    pdf = ResumePDF(template)
    engine = LAYOUT_ENGINES.get(template["layout"], _layout_single)
    engine(pdf, content, template)

    output = pdf.output()
    if isinstance(output, (bytes, bytearray)):
        return bytes(output)
    if isinstance(output, str):
        output = output.encode("latin-1")
    return bytes(output)
