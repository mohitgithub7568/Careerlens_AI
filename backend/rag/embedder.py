"""
RAG Embedder — HuggingFace Inference API (zero local model RAM)

Chunks resume text, stores chunks with API-based similarity search,
replacing the local sentence-transformers model to stay within Render's
512 MB memory limit.
"""

import logging
import os
import requests
from typing import Optional

logger = logging.getLogger("CareerLens.RAG")

# In-memory registry: session_id -> list of (chunk_text, embedding_vector)
_session_stores: dict[str, list[dict]] = {}

HF_API_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2"
HF_TOKEN = os.environ.get("HUGGINGFACEHUB_API_TOKEN", "")


def _get_hf_headers() -> dict:
    token = HF_TOKEN or os.environ.get("HUGGINGFACEHUB_API_TOKEN", "")
    return {"Authorization": f"Bearer {token}"}


def _similarity_score(source: str, sentences: list[str]) -> list[float]:
    """Call HF Inference API for sentence similarity scores."""
    try:
        payload = {"inputs": {"source_sentence": source, "sentences": sentences}}
        res = requests.post(HF_API_URL, headers=_get_hf_headers(), json=payload, timeout=30)
        if res.status_code == 200:
            scores = res.json()
            if isinstance(scores, list):
                return scores
        logger.warning(f"[RAG] HF API returned {res.status_code}: {res.text[:200]}")
        return [0.0] * len(sentences)
    except Exception as e:
        logger.error(f"[RAG] HF similarity API error: {e}")
        return [0.0] * len(sentences)


def chunk_resume_text(text: str, chunk_size: int = 300, overlap: int = 50) -> list[str]:
    """
    Split resume text into overlapping word-level chunks.

    Args:
        text: Raw resume text.
        chunk_size: Number of words per chunk.
        overlap: Number of words to overlap between consecutive chunks.

    Returns:
        List of text chunk strings.
    """
    words = text.split()
    chunks = []
    step = max(1, chunk_size - overlap)

    for i in range(0, len(words), step):
        chunk_words = words[i: i + chunk_size]
        chunk = " ".join(chunk_words).strip()
        if chunk:
            chunks.append(chunk)
        if i + chunk_size >= len(words):
            break

    logger.info(f"[RAG] Created {len(chunks)} chunks from {len(words)} words.")
    return chunks


def build_resume_store(session_id: str, resume_text: str) -> bool:
    """
    Build an in-memory chunk store for a session (no local ML model).

    Chunks are stored as plain text; similarity is computed on-demand
    via HF Inference API when queried.

    Args:
        session_id: Unique session identifier.
        resume_text: Full extracted resume text.

    Returns:
        True if store was built successfully, False otherwise.
    """
    try:
        chunks = chunk_resume_text(resume_text)
        if not chunks:
            logger.warning("[RAG] No chunks created — resume text may be empty.")
            return False

        _session_stores[session_id] = [{"text": c} for c in chunks]
        logger.info(f"[RAG] Built in-memory store for session {session_id[:8]}... with {len(chunks)} chunks.")
        return True

    except Exception as e:
        logger.error(f"[RAG] Failed to build resume store: {e}")
        return False


def query_resume_store(session_id: str, query: str, top_k: int = 3) -> str:
    """
    Retrieve the most semantically relevant resume chunks for a query
    using HF Inference API for similarity scoring.

    Args:
        session_id: The session whose resume store to query.
        query: The query string (e.g. "Python skills", "work experience").
        top_k: Number of top chunks to return.

    Returns:
        Concatenated relevant resume context string, or empty string if unavailable.
    """
    try:
        if session_id not in _session_stores:
            logger.warning(f"[RAG] No store found for session {session_id[:8]}...")
            return ""

        store = _session_stores[session_id]
        chunks = [item["text"] for item in store]

        if not chunks:
            return ""

        # Batch similarity scores via HF API
        scores = _similarity_score(query, chunks)
        ranked = sorted(zip(scores, chunks), key=lambda x: x[0], reverse=True)
        top_chunks = [text for _, text in ranked[:top_k]]

        context = "\n\n".join(top_chunks)
        logger.info(f"[RAG] Retrieved {len(top_chunks)} chunks for query: '{query[:50]}'")
        return context

    except Exception as e:
        logger.error(f"[RAG] Query failed: {e}")
        return ""


def delete_resume_store(session_id: str) -> bool:
    """
    Remove the in-memory store for a session (cleanup on session end).

    Args:
        session_id: The session to clean up.

    Returns:
        True if deleted, False if not found or error.
    """
    try:
        if session_id in _session_stores:
            del _session_stores[session_id]
            logger.info(f"[RAG] Deleted store for session {session_id[:8]}...")
            return True
        return False
    except Exception as e:
        logger.error(f"[RAG] Failed to delete store: {e}")
        return False


def get_resume_context(session_id: str, query: str, top_k: int = 3) -> str:
    """
    Convenience wrapper: retrieves relevant resume context for a query.
    Returns empty string gracefully if RAG store is unavailable.
    """
    return query_resume_store(session_id, query, top_k)
