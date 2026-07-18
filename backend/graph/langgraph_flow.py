"""
LangGraph Flow — Parallel Fan-Out Architecture

Graph topology:

    resume_node
         │
    ┌────┴────┬──────────┐
    │         │          │
  ats_node skills_node projects_node   ← parallel
    │         │          │
    └────┬────┴──────────┘
    aggregator_node
         │
    decision_node
    ├── yes → interview_node → evaluator_node ─┐
    └── no  ──────────────────────────────────┤
                                               ↓
                                         feedback_node → END
"""

import sys
import pprint
import logging
from pathlib import Path
from typing import TypedDict, Annotated
import operator

sys.path.append(str(Path(__file__).resolve().parent.parent))

from langgraph.graph import StateGraph, END

from agents.resume_agent import analyze_resume
from agents.ats_agent import ats_agent
from agents.interviewer_agent import generate_questions
from agents.evaluator_agent import evaluator_agent
from agents.feedback_agent import feedback_agent
from agents.skills_agent import skills_agent
from agents.projects_agent import projects_agent

logger = logging.getLogger("CareerLens.Graph")

MAX_INTERVIEW_QUESTIONS = 7


# ──────────────────────────────────────────────
# 1. Graph State
# ──────────────────────────────────────────────

class GraphState(TypedDict):
    pdf_path: str
    session_id: str          # For RAG store lookup
    user_id: str             # For long-term memory
    resume: dict
    ats: dict
    skills_analysis: dict    # NEW: from skills_agent (parallel)
    projects_analysis: dict  # NEW: from projects_agent (parallel)
    interview: dict
    evaluation: dict
    feedback: dict
    role: str
    start_interview: bool
    conversation_history: list  # Short-term memory
    user_memory: str            # Long-term memory context
    parallel_results: Annotated[list[dict], operator.add]  # Fan-out merge list


# ──────────────────────────────────────────────
# 2. Node Functions
# ──────────────────────────────────────────────

def resume_node(state: GraphState) -> GraphState:
    """Node 1 — Extracts and analyzes resume. Populates RAG store."""
    logger.info("[GRAPH] 📄 Resume Node")
    try:
        # Run resume analysis
        state["resume"] = analyze_resume(state["pdf_path"])

        # Build RAG store for this session
        session_id = state.get("session_id", "")
        if session_id:
            try:
                from rag.embedder import build_resume_store
                from agents.resume_agent import extract_text_from_pdf
                resume_text = extract_text_from_pdf(state["pdf_path"])
                build_resume_store(session_id, resume_text)
                logger.info(f"[GRAPH] RAG store built for session {session_id[:8]}...")
            except Exception as rag_err:
                logger.warning(f"[GRAPH] RAG store build failed (non-fatal): {rag_err}")

        # Load long-term memory if user_id is set
        user_id = state.get("user_id", "")
        if user_id:
            try:
                from memory.long_term import load_user_memory
                state["user_memory"] = load_user_memory(user_id)
                logger.info(f"[GRAPH] Loaded long-term memory for user {user_id[:8]}...")
            except Exception as mem_err:
                logger.warning(f"[GRAPH] Long-term memory load failed (non-fatal): {mem_err}")

    except Exception as e:
        logger.error(f"[GRAPH] Resume Node failed: {e}")
        state["resume"] = {"error": str(e)}
    return state


def ats_node(state: GraphState) -> dict:
    """Node 2a — ATS optimization (runs in parallel)."""
    logger.info("[GRAPH] 🎯 ATS Node (parallel)")
    try:
        session_id = state.get("session_id", "")
        ats_res = ats_agent(state["resume"], session_id=session_id)
        return {"ats": ats_res}
    except Exception as e:
        logger.error(f"[GRAPH] ATS Node failed: {e}")
        return {"ats": {"error": str(e)}}


def skills_node(state: GraphState) -> dict:
    """Node 2b — Skills gap analysis (runs in parallel)."""
    logger.info("[GRAPH] 🧠 Skills Node (parallel)")
    try:
        session_id = state.get("session_id", "")
        role = state.get("role", "Software Engineer")
        skills_res = skills_agent(state["resume"], role=role, session_id=session_id)
        return {"skills_analysis": skills_res}
    except Exception as e:
        logger.error(f"[GRAPH] Skills Node failed: {e}")
        return {"skills_analysis": {"error": str(e)}}


def projects_node(state: GraphState) -> dict:
    """Node 2c — Project portfolio evaluation (runs in parallel)."""
    logger.info("[GRAPH] 📁 Projects Node (parallel)")
    try:
        session_id = state.get("session_id", "")
        role = state.get("role", "Software Engineer")
        projects_res = projects_agent(state["resume"], role=role, session_id=session_id)
        return {"projects_analysis": projects_res}
    except Exception as e:
        logger.error(f"[GRAPH] Projects Node failed: {e}")
        return {"projects_analysis": {"error": str(e)}}



def aggregator_node(state: GraphState) -> GraphState:
    """Node 3 — Merges outputs from parallel analysis nodes."""
    logger.info("[GRAPH] 🔀 Aggregator Node — merging parallel results")
    # All parallel results are already in state via their respective keys.
    # This node is a synchronization barrier; no extra work needed.
    ats_score = state.get("ats", {}).get("ats_score", "N/A")
    skill_score = state.get("skills_analysis", {}).get("skill_match_score", "N/A")
    proj_score = state.get("projects_analysis", {}).get("overall_portfolio_score", "N/A")
    logger.info(f"[GRAPH] Merged: ATS={ats_score}, Skills={skill_score}%, Projects={proj_score}")
    return state


def decision_node(state: GraphState) -> GraphState:
    """Node 4 — Sets interview flag (called by API; no stdin)."""
    logger.info("[GRAPH] 🔀 Decision Node")
    # Decision is pre-set in the initial state by the API caller.
    # This node is a passthrough for the graph router.
    return state


def interview_node(state: GraphState) -> GraphState:
    """Node 5 — Generates interview questions (actual Q&A done via API)."""
    logger.info(f"[GRAPH] 🎤 Interview Node (role: {state.get('role', 'Unknown')})")
    try:
        session_id = state.get("session_id", "")
        user_memory = state.get("user_memory", "")
        role = state.get("role", "Software Engineer")

        # Get RAG context for the role
        rag_context = ""
        if session_id:
            try:
                from rag.embedder import get_resume_context
                rag_context = get_resume_context(session_id, role, top_k=3)
            except Exception:
                pass

        questions = generate_questions(
            state["resume"],
            role,
            rag_context=rag_context,
            memory_context=user_memory
        )

        if not questions:
            state["interview"] = {"questions": [], "answers": [], "qa_pairs": []}
            return state

        questions = questions[:MAX_INTERVIEW_QUESTIONS]
        state["interview"] = {
            "questions": questions,
            "answers": [],
            "qa_pairs": []
        }
        logger.info(f"[GRAPH] Generated {len(questions)} interview questions.")
    except Exception as e:
        logger.error(f"[GRAPH] Interview Node failed: {e}")
        state["interview"] = {"error": str(e)}
    return state


def evaluator_node(state: GraphState) -> GraphState:
    """Node 6 — Evaluates interview answers."""
    logger.info("[GRAPH] 📊 Evaluator Node")
    try:
        interview_data = state.get("interview", {})
        qa_pairs = interview_data.get("qa_pairs", [])

        if not qa_pairs:
            state["evaluation"] = {"error": "No interview data to evaluate"}
            return state

        user_memory = state.get("user_memory", "")
        state["evaluation"] = evaluator_agent(interview_data, memory_context=user_memory)
    except Exception as e:
        logger.error(f"[GRAPH] Evaluator Node failed: {e}")
        state["evaluation"] = {"error": str(e)}
    return state


def feedback_node(state: GraphState) -> GraphState:
    """Node 7 — Generates final career guidance and saves long-term memory."""
    logger.info("[GRAPH] 🏁 Feedback Node")
    try:
        state["feedback"] = feedback_agent({
            "resume": state["resume"],
            "ats": state["ats"],
            "skills_analysis": state.get("skills_analysis", {}),
            "projects_analysis": state.get("projects_analysis", {}),
            "evaluation": state.get("evaluation", {})
        })

        # Save long-term memory after session completes
        user_id = state.get("user_id", "")
        if user_id:
            try:
                from memory.long_term import save_session_memory
                save_session_memory(
                    user_id=user_id,
                    resume=state["resume"],
                    evaluation=state.get("evaluation"),
                    role=state.get("role", "")
                )
                logger.info("[GRAPH] Long-term memory saved.")
            except Exception as mem_err:
                logger.warning(f"[GRAPH] Memory save failed (non-fatal): {mem_err}")

    except Exception as e:
        logger.error(f"[GRAPH] Feedback Node failed: {e}")
        state["feedback"] = {"error": str(e)}
    return state


# ──────────────────────────────────────────────
# 3. Conditional Router
# ──────────────────────────────────────────────

def route_decision(state: GraphState) -> str:
    """Routes to interview or directly to feedback based on user choice."""
    if state.get("start_interview", False):
        return "interview"
    return "feedback"


# ──────────────────────────────────────────────
# 4. Build the Parallel LangGraph
# ──────────────────────────────────────────────

graph = StateGraph(GraphState)

# Add all nodes
graph.add_node("resume", resume_node)
graph.add_node("ats", ats_node)                # parallel branch 1
graph.add_node("skills", skills_node)           # parallel branch 2
graph.add_node("projects", projects_node)       # parallel branch 3
graph.add_node("aggregator", aggregator_node)   # merge point
graph.add_node("decision", decision_node)
graph.add_node("interview", interview_node)
graph.add_node("evaluator", evaluator_node)
graph.add_node("feedback", feedback_node)

# Set entry point
graph.set_entry_point("resume")

# Resume → fan-out to 3 parallel nodes
graph.add_edge("resume", "ats")
graph.add_edge("resume", "skills")
graph.add_edge("resume", "projects")

# All 3 parallel nodes → aggregator
graph.add_edge("ats", "aggregator")
graph.add_edge("skills", "aggregator")
graph.add_edge("projects", "aggregator")

# Aggregator → decision
graph.add_edge("aggregator", "decision")

# Conditional routing after decision
graph.add_conditional_edges(
    "decision",
    route_decision,
    {
        "interview": "interview",
        "feedback": "feedback",
    }
)

# Remaining sequential edges
graph.add_edge("interview", "evaluator")
graph.add_edge("evaluator", "feedback")
graph.add_edge("feedback", END)

# Compile the graph
app = graph.compile()


# ──────────────────────────────────────────────
# 5. Execution Function
# ──────────────────────────────────────────────

def run_langgraph(
    pdf_path: str,
    session_id: str = "",
    user_id: str = "",
    role: str = "",
    start_interview: bool = False
) -> dict:
    """
    Execute the full CareerLens AI parallel pipeline.

    Flow:
        Resume → [ATS ∥ Skills ∥ Projects] → Aggregator → Decision
                 ├─ yes → Interview → Evaluator ─┐
                 └─ no  ──────────────────────────┤
                                                  ↓
                                           Feedback → END
    """
    logger.info("🚀 CareerLens AI — Parallel LangGraph Flow Starting")

    initial_state: GraphState = {
        "pdf_path": pdf_path,
        "session_id": session_id,
        "user_id": user_id,
        "resume": {},
        "ats": {},
        "skills_analysis": {},
        "projects_analysis": {},
        "interview": {},
        "evaluation": {},
        "feedback": {},
        "role": role,
        "start_interview": start_interview,
        "conversation_history": [],
        "user_memory": "",
        "parallel_results": [],
    }

    result = app.invoke(initial_state)
    logger.info("✅ LangGraph Parallel Flow Complete!")
    return result
