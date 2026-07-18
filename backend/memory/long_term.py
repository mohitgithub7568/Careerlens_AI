"""
Long-Term Memory — MongoDB-backed user memory store

Persists key career facts (strengths, weaknesses, goals) extracted after
each session. On next login the user's history is recalled and injected
into agent prompts for a personalized experience.
"""

import logging
import json
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("CareerLens.Memory.LongTerm")

# Module-level MongoDB collection reference (set by api/main.py at startup)
_memory_collection = None


def set_memory_collection(collection) -> None:
    """Inject the MongoDB collection reference from FastAPI startup."""
    global _memory_collection
    _memory_collection = collection
    logger.info("[LongTermMemory] MongoDB memory collection connected.")


def extract_key_facts(resume: dict, evaluation: Optional[dict] = None) -> dict:
    """
    Synchronously extract key memorable facts from a session's results.
    Runs a lightweight LLM call to summarize what to remember.

    Args:
        resume: Parsed resume dict from resume_agent.
        evaluation: Evaluation result dict from evaluator_agent (optional).

    Returns:
        Dict with extracted facts: strengths, weaknesses, skills, role.
    """
    try:
        from models.llm import generate_text
        import json as _json

        data_summary = {
            "name": resume.get("name", "Unknown"),
            "skills": resume.get("skills", [])[:10],
            "education": resume.get("education", [])[:3],
            "strengths": resume.get("strengths", [])[:5],
            "weaknesses": resume.get("weaknesses", [])[:5],
        }

        if evaluation:
            data_summary["overall_score"] = evaluation.get("overall_score", 0)
            data_summary["interview_strengths"] = evaluation.get("overall_strengths", [])[:3]
            data_summary["interview_weaknesses"] = evaluation.get("overall_weaknesses", [])[:3]

        prompt = f"""Summarize the following candidate data into a brief memory object.

Data:
{_json.dumps(data_summary, indent=2)}

Return ONLY JSON:
{{
  "key_strengths": ["top 3 strengths"],
  "key_weaknesses": ["top 3 areas to improve"],
  "top_skills": ["top 5 skills"],
  "confidence_level": "Beginner/Intermediate/Advanced",
  "summary": "One sentence candidate summary"
}}"""

        response = generate_text(prompt)

        # Parse the JSON response
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        facts = _json.loads(text)
        logger.info("[LongTermMemory] Key facts extracted via LLM.")
        return facts

    except Exception as e:
        logger.warning(f"[LongTermMemory] LLM fact extraction failed: {e}. Using fallback.")
        return {
            "key_strengths": resume.get("strengths", [])[:3],
            "key_weaknesses": resume.get("weaknesses", [])[:3],
            "top_skills": resume.get("skills", [])[:5],
            "confidence_level": "Unknown",
            "summary": f"Resume analyzed for {resume.get('name', 'candidate')}."
        }


def save_session_memory(user_id: str, resume: dict, evaluation: Optional[dict] = None, role: str = "") -> bool:
    """
    Extract and persist a session's key facts to MongoDB.

    Args:
        user_id: The authenticated user's ID.
        resume: Resume analysis dict.
        evaluation: Interview evaluation dict (optional).
        role: Target role applied for.

    Returns:
        True if saved successfully.
    """
    if _memory_collection is None:
        logger.warning("[LongTermMemory] No MongoDB collection set. Memory not saved.")
        return False

    try:
        facts = extract_key_facts(resume, evaluation)
        memory_doc = {
            "user_id": user_id,
            "role": role,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "facts": facts,
        }
        _memory_collection.insert_one(memory_doc)
        logger.info(f"[LongTermMemory] Saved memory for user {user_id[:8]}...")
        return True
    except Exception as e:
        logger.error(f"[LongTermMemory] Failed to save memory: {e}")
        return False


def load_user_memory(user_id: str, limit: int = 3) -> str:
    """
    Retrieve the most recent session memories for a user.

    Args:
        user_id: The user's ID.
        limit: Maximum number of past sessions to recall.

    Returns:
        Formatted memory string for injection into prompts.
    """
    if _memory_collection is None:
        return ""

    try:
        docs = list(
            _memory_collection
            .find({"user_id": user_id})
            .sort("timestamp", -1)
            .limit(limit)
        )

        if not docs:
            return ""

        lines = ["--- Candidate Long-Term Memory ---"]
        for doc in reversed(docs):  # Chronological order
            facts = doc.get("facts", {})
            ts = doc.get("timestamp", "")[:10]  # YYYY-MM-DD
            role = doc.get("role", "Unknown role")
            lines.append(f"\nSession ({ts}, Role: {role}):")
            lines.append(f"  Summary: {facts.get('summary', '')}")
            lines.append(f"  Strengths: {', '.join(facts.get('key_strengths', []))}")
            lines.append(f"  Areas to improve: {', '.join(facts.get('key_weaknesses', []))}")
            lines.append(f"  Top skills: {', '.join(facts.get('top_skills', []))}")
            lines.append(f"  Level: {facts.get('confidence_level', 'Unknown')}")
        lines.append("---------------------------------")

        context = "\n".join(lines)
        logger.info(f"[LongTermMemory] Loaded {len(docs)} memory entries for user {user_id[:8]}...")
        return context

    except Exception as e:
        logger.error(f"[LongTermMemory] Failed to load memories: {e}")
        return ""


def get_memory_entries(user_id: str) -> list[dict]:
    """
    Return raw memory entries for a user (for API/frontend display).

    Returns:
        List of memory dicts (without _id field).
    """
    if _memory_collection is None:
        return []

    try:
        docs = list(
            _memory_collection
            .find({"user_id": user_id}, {"_id": 0})
            .sort("timestamp", -1)
            .limit(10)
        )
        return docs
    except Exception as e:
        logger.error(f"[LongTermMemory] Failed to get memory entries: {e}")
        return []
