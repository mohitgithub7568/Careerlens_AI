"""
Skills Gap Agent — Focused technical skill analysis.

Runs in parallel with the ATS and Projects agents in the LangGraph fan-out.
Analyzes the candidate's skills vs. market requirements for their target role.
"""

import json
import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
from models.llm import generate_text

logger = logging.getLogger("CareerLens.Agent.Skills")

SKILLS_PROMPT_TEMPLATE = """
You are a senior technical recruiter and skills analyst.

Analyze the following candidate's skills and identify gaps for the role: {role}

Resume Skills Data:
\"\"\"
{skills_data}
\"\"\"

Instructions:
- List confirmed skills present in the resume
- Identify critical skills missing for the target role
- Rate the overall skill match as a percentage
- Suggest the top 5 skills to learn next
- Identify any niche/rare skills that are a competitive advantage

Return ONLY valid JSON:
{{
  "confirmed_skills": ["skills found in resume"],
  "missing_critical_skills": ["skills missing for the role"],
  "skill_match_score": 75,
  "skills_to_learn_next": ["top 5 recommended skills"],
  "competitive_advantages": ["rare or impressive skills"],
  "skill_level_assessment": "Beginner/Intermediate/Advanced"
}}
"""


def _parse_json(response: str) -> dict:
    text = response.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    return {"raw_response": response}


def skills_agent(resume: dict, role: str = "Software Engineer", session_id: str = "") -> dict:
    """
    Analyze candidate skill gaps for a target role.

    Args:
        resume: Parsed resume dict from resume_agent.
        role: Target job role.
        session_id: Session ID for RAG context (optional).

    Returns:
        Dict with skills analysis results.
    """
    logger.info(f"[SkillsAgent] Analyzing skills for role: {role}")

    # Optionally enrich with RAG context
    rag_context = ""
    if session_id:
        try:
            from rag.embedder import get_resume_context
            rag_context = get_resume_context(session_id, f"{role} skills requirements", top_k=2)
        except Exception as e:
            logger.warning(f"[SkillsAgent] RAG unavailable: {e}")

    skills_data = {
        "skills": resume.get("skills", []),
        "experience": resume.get("experience", [])[:3],
        "education": resume.get("education", [])[:2],
    }

    if rag_context:
        skills_data["additional_context"] = rag_context[:500]

    prompt = SKILLS_PROMPT_TEMPLATE.format(
        role=role,
        skills_data=json.dumps(skills_data, indent=2)
    )

    try:
        response = generate_text(prompt)
        result = _parse_json(response)
        logger.info(f"[SkillsAgent] Analysis complete. Match score: {result.get('skill_match_score', 'N/A')}%")
        return result
    except Exception as e:
        logger.error(f"[SkillsAgent] Failed: {e}")
        return {
            "confirmed_skills": resume.get("skills", []),
            "missing_critical_skills": [],
            "skill_match_score": 0,
            "skills_to_learn_next": [],
            "competitive_advantages": [],
            "skill_level_assessment": "Unknown",
            "error": str(e)
        }
