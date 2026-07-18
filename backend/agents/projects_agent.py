"""
Projects Evaluation Agent — Deep-dives into candidate's projects.

Runs in parallel with the ATS and Skills agents in the LangGraph fan-out.
Evaluates project quality, tech stack, and impact for the target role.
"""

import json
import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
from models.llm import generate_text

logger = logging.getLogger("CareerLens.Agent.Projects")

PROJECTS_PROMPT_TEMPLATE = """
You are a technical hiring manager evaluating a candidate's project portfolio.

Target Role: {role}

Candidate Projects:
\"\"\"
{projects_data}
\"\"\"

Instructions:
- Score each project out of 10 for quality, complexity, and relevance
- Identify the tech stack demonstrated
- Highlight any impressive technical choices
- Suggest improvements for each project
- Recommend new projects to build for the target role

Return ONLY valid JSON:
{{
  "project_evaluations": [
    {{
      "project_name": "...",
      "score": 7,
      "strengths": ["..."],
      "improvements": ["..."],
      "tech_stack_demonstrated": ["..."]
    }}
  ],
  "overall_portfolio_score": 70,
  "portfolio_strengths": ["..."],
  "portfolio_gaps": ["..."],
  "recommended_projects_to_build": [
    {{
      "title": "...",
      "description": "...",
      "why": "..."
    }}
  ]
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


def projects_agent(resume: dict, role: str = "Software Engineer", session_id: str = "") -> dict:
    """
    Evaluate the candidate's project portfolio for a target role.

    Args:
        resume: Parsed resume dict from resume_agent.
        role: Target job role.
        session_id: Session ID for RAG context (optional).

    Returns:
        Dict with project evaluation results.
    """
    logger.info(f"[ProjectsAgent] Evaluating projects for role: {role}")

    # Optionally enrich with RAG context
    rag_context = ""
    if session_id:
        try:
            from rag.embedder import get_resume_context
            rag_context = get_resume_context(session_id, "projects experience portfolio", top_k=2)
        except Exception as e:
            logger.warning(f"[ProjectsAgent] RAG unavailable: {e}")

    projects_data = {
        "projects": resume.get("projects", []),
        "experience": resume.get("experience", [])[:3],
    }

    if rag_context:
        projects_data["additional_context"] = rag_context[:500]

    # Handle empty projects gracefully
    if not projects_data["projects"]:
        logger.warning("[ProjectsAgent] No projects found in resume.")
        return {
            "project_evaluations": [],
            "overall_portfolio_score": 0,
            "portfolio_strengths": [],
            "portfolio_gaps": ["No projects listed in resume."],
            "recommended_projects_to_build": [
                {
                    "title": f"Build a {role} portfolio project",
                    "description": "Create a practical project demonstrating core skills for the role.",
                    "why": "No projects currently listed; this is critical for job applications."
                }
            ]
        }

    prompt = PROJECTS_PROMPT_TEMPLATE.format(
        role=role,
        projects_data=json.dumps(projects_data, indent=2)
    )

    try:
        response = generate_text(prompt)
        result = _parse_json(response)
        score = result.get('overall_portfolio_score', 'N/A')
        logger.info(f"[ProjectsAgent] Evaluation complete. Portfolio score: {score}")
        return result
    except Exception as e:
        logger.error(f"[ProjectsAgent] Failed: {e}")
        return {
            "project_evaluations": [],
            "overall_portfolio_score": 0,
            "portfolio_strengths": [],
            "portfolio_gaps": [],
            "recommended_projects_to_build": [],
            "error": str(e)
        }
