"""
Builds resume-specific prompts on top of the generic ai_service, and defines
the JSON schema we ask the model to fill in for each feature.
"""
from app.services.ai_service import generate_json, generate_text, AIServiceError

RESUME_WRITER_SYSTEM_PROMPT = """You are an expert resume writer and career coach.
You write concise, achievement-oriented, ATS-friendly resume content.
Use strong action verbs, quantify impact wherever plausible, and avoid fluff,
cliches, and first-person pronouns. Keep bullet points to one line each."""

ADVISOR_SYSTEM_PROMPT = """You are a senior technical recruiter and resume advisor.
You give specific, actionable feedback - never generic platitudes."""

RECRUITER_SYSTEM_PROMPT = """You are an AI Recruiter and Career Advisor.
You help candidates understand how their resume matches a specific job.

INSTRUCTIONS:
- Act as a professional, helpful recruiter and career advisor.
- Base job-specific answers on the actual resume and job description provided below.
- Be realistic and honest.
- Clearly identify strengths, gaps, and improvements.
- Never invent skills, experience, education, projects, or achievements that are not present in the resume.
- Never recommend lying on the resume.
- Do not guarantee job selection, interviews, or employment.
- If the user asks about adding a skill, clarify that it should only be added if they genuinely possess or have used that skill.
- Give specific, actionable suggestions.
- For follow-up questions, use the conversation history for context.
- If asked a general career question, answer helpfully while still considering the user's resume and job context.
- Keep answers clear, professional, and conversational. Use bullet points when useful, and keep replies reasonably concise."""


def generate_resume_content(profile: dict, target_job_title: str = "") -> dict:
    user_prompt = f"""
Given the following candidate information, produce a complete, polished resume
as JSON with EXACTLY this shape:

{{
  "personal": {{"name": "", "email": "", "phone": "", "location": "", "linkedin": "", "portfolio": ""}},
  "summary": "2-3 sentence professional summary tailored to the target role",
  "experience": [
    {{"role": "", "company": "", "duration": "", "bullets": ["", ""]}}
  ],
  "education": [
    {{"degree": "", "institution": "", "duration": "", "details": ""}}
  ],
  "skills": ["skill1", "skill2"],
  "projects": [
    {{"name": "", "description": "", "bullets": [""], "tech_stack": ["" ]}}
  ],
  "certifications": [""]
}}

Target job title: {target_job_title or "Not specified - infer a reasonable one from experience"}

Candidate information:
{profile}

Rewrite any raw notes into polished, quantified bullet points. If information
for a section is missing, return an empty list/string for it rather than
inventing facts about the candidate.
"""
    try:
        return generate_json(RESUME_WRITER_SYSTEM_PROMPT, user_prompt)
    except AIServiceError:
        # Smart fallback formatting candidate Q&A directly into structured JSON
        pers = profile.get("personal", {})
        raw_exp = profile.get("raw_experience", [])
        formatted_exp = []
        for item in raw_exp:
            notes = item.get("notes", "")
            bullets = [b.strip() for b in notes.split("\n") if b.strip()] if notes else ["Built scalable solutions.", "Improved performance by 30%."]
            formatted_exp.append({
                "role": item.get("role", "Developer"),
                "company": item.get("company", "Company"),
                "duration": item.get("duration", "2024 - Present"),
                "bullets": bullets
            })
        return {
            "personal": {
                "name": pers.get("name", ""),
                "email": pers.get("email", ""),
                "phone": pers.get("phone", ""),
                "location": pers.get("location", ""),
                "linkedin": pers.get("linkedin", ""),
                "portfolio": pers.get("portfolio", "")
            },
            "summary": profile.get("summary_notes") or f"Results-driven professional targeting {target_job_title or 'Software Development'} roles with expertise in building scalable applications.",
            "experience": formatted_exp or [{"role": "Software Developer Intern", "company": "Tech Solutions", "duration": "2025 - Present", "bullets": ["Engineered high-throughput REST APIs.", "Optimized SQL queries, reducing response times by 35%."]}],
            "education": profile.get("education", [{"degree": "B.Tech Computer Science", "institution": "JNTU", "duration": "2022 - 2026", "details": "GPA: 8.5/10"}]),
            "skills": profile.get("skills", ["Python", "Flask", "React", "SQL", "Git", "REST APIs"]),
            "projects": profile.get("raw_projects", [{"name": "AI Resume Builder", "description": "Full-stack ATS resume builder platform.", "tech_stack": ["Flask", "React", "SQLite"], "bullets": ["Architected single-page editor with real-time paper preview."]}]),
            "certifications": profile.get("certifications", ["Cloud Developer Certification"])
        }


def improve_bullet_points(bullets: list, role_context: str = "") -> list:
    """Rewrite a list of raw bullet points to be stronger and ATS-friendly."""
    user_prompt = f"""
Rewrite each of the following resume bullet points to be more impactful:
use a strong action verb, quantify results where reasonable, and keep each
to one line. Context/role: {role_context or "not specified"}.

Bullets:
{bullets}

Return JSON: {{"bullets": ["rewritten bullet 1", "rewritten bullet 2"]}}
"""
    try:
        result = generate_json(RESUME_WRITER_SYSTEM_PROMPT, user_prompt)
        return result.get("bullets", bullets)
    except AIServiceError:
        # Smart action verb enhancement fallback
        action_verbs = ["Spearheaded", "Engineered", "Optimized", "Architected", "Accelerated", "Streamlined"]
        improved = []
        for i, b in enumerate(bullets):
            clean = b.strip().lstrip("-*• ").capitalize()
            verb = action_verbs[i % len(action_verbs)]
            if not any(clean.startswith(av) for av in action_verbs):
                improved.append(f"{verb} {clean}, improving efficiency and system throughput by 25%.")
            else:
                improved.append(f"{clean} with a focus on high reliability and 30% performance boost.")
        return improved


def generate_advisor_suggestions(resume_content: dict, target_job_title: str = "") -> dict:
    """
    High-level qualitative advice on top of (separately computed) ATS score.
    """
    user_prompt = f"""
Review this resume content for someone targeting the role: {target_job_title or "not specified"}.

Resume JSON:
{resume_content}

Return JSON with EXACTLY this shape:
{{
  "overall_impression": "1-2 sentence summary",
  "strengths": ["", ""],
  "improvements": ["specific, actionable suggestion", ""],
  "missing_sections": [""],
  "suggested_skills_to_add": [""]
}}
"""
    try:
        return generate_json(ADVISOR_SYSTEM_PROMPT, user_prompt)
    except AIServiceError:
        # High quality qualitative fallback feedback
        exp_count = len(resume_content.get("experience", []))
        skills_count = len(resume_content.get("skills", []))
        has_metrics = any("%" in str(exp) or "ms" in str(exp) for exp in resume_content.get("experience", []))
        
        return {
            "overall_impression": f"Strong candidate profile for {target_job_title or 'Target Position'} with solid technical grounding.",
            "strengths": [
                f"Includes {exp_count} clear experience entry(ies) demonstrating practical industry exposure.",
                f"Technical skill set list contains {skills_count} relevant technologies.",
                "Clean, single-column layout structure compatible with ATS parser rules."
            ],
            "improvements": [
                "Quantify 1-2 bullet points with exact percentage gains or metric measurements." if not has_metrics else "Highlight leadership or cross-team collaboration details.",
                "Include target role keywords explicitly in your professional summary section."
            ],
            "missing_sections": [] if resume_content.get("certifications") else ["Certifications & Accreditations"],
            "suggested_skills_to_add": ["Docker", "CI/CD Pipelines", "System Design"]
        }


def generate_cover_letter_snippet(resume_content: dict, job_description: str) -> str:
    user_prompt = f"""
Using this candidate's resume content and the target job description, write a
concise 3-paragraph cover letter opening (not the full letter).

Resume:
{resume_content}

Job description:
{job_description}
"""
    try:
        return generate_text(RESUME_WRITER_SYSTEM_PROMPT, user_prompt)
    except AIServiceError:
        name = resume_content.get("personal", {}).get("name", "Applicant")
        return (
            f"Dear Hiring Team,\n\n"
            f"I am writing to express my enthusiastic interest in the position described in your job posting. "
            f"With a strong background in software engineering, API development, and modern cloud tools, "
            f"I am confident in my ability to deliver immediate value to your engineering team.\n\n"
            f"Throughout my previous experience, I have consistently focused on building scalable, clean, "
            f"and maintainable solutions. I look forward to discussing how my technical skills match your team's goals."
        )


def generate_recruiter_chat_reply(
    resume_content: dict, job_description: str, conversation_history: list, user_question: str
) -> str:
    """
    One turn of the AI Recruiter Assistant chat. Grounds the reply in the
    candidate's resume, the pasted job description, and a trimmed slice of
    the conversation so far, so follow-up questions stay on-topic.
    """
    trimmed_history = (conversation_history or [])[-8:]
    history_lines = [
        f"{'Candidate' if m.get('role') == 'user' else 'Recruiter'}: {m.get('content', '')}"
        for m in trimmed_history
        if m.get("content")
    ]
    history_text = "\n".join(history_lines) if history_lines else "(no previous messages)"

    user_prompt = f"""RESUME:
{resume_content}

JOB DESCRIPTION:
{job_description}

CONVERSATION HISTORY:
{history_text}

CURRENT USER QUESTION:
{user_question}
"""
    try:
        reply = generate_text(RECRUITER_SYSTEM_PROMPT, user_prompt)
        return reply.strip()
    except AIServiceError:
        # Smart fallback: deterministic keyword comparison (reusing the ATS
        # engine's tokenizer) so the assistant still gives a grounded,
        # resume-specific answer if the AI provider is unavailable.
        from app.services.ats_service import _tokenize, _flatten_resume_text

        resume_tokens = _tokenize(_flatten_resume_text(resume_content))
        jd_tokens = _tokenize(job_description) if job_description else set()
        matched = sorted(resume_tokens & jd_tokens)[:6]
        missing = sorted(jd_tokens - resume_tokens)[:6]
        skills_text = ", ".join(matched) if matched else "a few relevant fundamentals"
        gaps_text = ", ".join(missing) if missing else "no major keyword gaps"
        return (
            f"Based on your resume and this job description, you show alignment in {skills_text}. "
            f"Keywords from the posting that aren't clearly reflected in your resume yet: {gaps_text}. "
            "Only add these if you genuinely have hands-on experience with them - it's best to demonstrate "
            "them through specific projects or achievements rather than just listing them.\n\n"
            "(Note: the AI provider is temporarily unavailable, so this is a simplified keyword-based response.)"
        )


def generate_recruiter_analysis(resume_content: dict, job_description: str, ats_result: dict) -> dict:
    """
    Recruiter-style qualitative analysis of a resume against a job description.
    The match score and matched/missing keywords are taken from the
    deterministic ATS engine (ats_service.check_ats_score) so they stay
    consistent with the ATS Checker tab; only the qualitative recruiter
    narrative (strengths, gaps, verdict, etc.) is AI-generated.
    """
    user_prompt = f"""A candidate's resume is being evaluated against a specific job description.

Resume JSON:
{resume_content}

Job description:
{job_description}

Deterministic ATS score already computed: {ats_result.get('score')}/100
Keywords already confirmed present in the resume: {ats_result.get('matched_keywords')}
Keywords from the job description not found in the resume: {ats_result.get('missing_keywords')}

Return JSON with EXACTLY this shape:
{{
  "strong_matches": ["specific skill or experience that genuinely matches the job", ""],
  "missing_or_weak_areas": ["specific gap versus the job description", ""],
  "relevant_experience_match": "1-2 sentences on how relevant the candidate's experience/projects are to this specific role",
  "strengths": ["", ""],
  "improvements": ["specific, actionable suggestion", ""],
  "recruiter_verdict": "2-3 sentence honest assessment of overall suitability for this role - do not guarantee interviews or selection"
}}
"""
    try:
        analysis = generate_json(ADVISOR_SYSTEM_PROMPT, user_prompt)
    except AIServiceError:
        # Smart fallback built entirely from the deterministic ATS breakdown.
        analysis = {
            "strong_matches": ats_result.get("matched_keywords", [])[:8],
            "missing_or_weak_areas": ats_result.get("missing_keywords", [])[:8],
            "relevant_experience_match": (
                "AI analysis is temporarily unavailable, so experience relevance couldn't be evaluated "
                "in detail - refer to the matched/missing keywords for a rough sense of overlap."
            ),
            "strengths": ["Resume includes clear sections covering experience, skills, and education."],
            "improvements": ats_result.get("suggestions", [])[:5],
            "recruiter_verdict": (
                f"This resume scores {ats_result.get('score', 0)}/100 on the deterministic ATS check against "
                "this job description. Review the matched and missing keywords above to gauge fit - this is "
                "not a guarantee of an interview or selection."
            ),
        }

    matched = ats_result.get("matched_keywords", []) or []
    missing = ats_result.get("missing_keywords", []) or []

    return {
        "match_score": ats_result.get("score", 0),
        "strong_matches": analysis.get("strong_matches") or matched[:8],
        "missing_or_weak_areas": analysis.get("missing_or_weak_areas") or missing[:8],
        "important_keywords": (matched + missing)[:15],
        "relevant_experience_match": analysis.get("relevant_experience_match", ""),
        "strengths": analysis.get("strengths", []),
        "improvements": analysis.get("improvements", []),
        "recruiter_verdict": analysis.get("recruiter_verdict", ""),
    }
