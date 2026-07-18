"""
RAG Embedder — ChromaDB + Sentence Transformers

Chunks resume text, builds a per-session vector store, and enables
semantic retrieval of relevant resume sections before LLM calls.
"""

import logging
from typing import Optional

logger = logging.getLogger("CareerLens.RAG")

# Lazy imports — only load heavy models when first used
_chroma_client = None
_embedding_model = None

# In-memory registry: session_id -> ChromaDB collection name
_session_collections: dict[str, str] = {}


def _get_chroma_client():
    """Lazily initialize ChromaDB client."""
    global _chroma_client
    if _chroma_client is None:
        try:
            import chromadb
            import os
            persist_dir = os.environ.get("CHROMA_PERSIST_DIR")
            if persist_dir:
                _chroma_client = chromadb.PersistentClient(path=persist_dir)
                logger.info(f"[RAG] ChromaDB client initialized with persistent path: {persist_dir}")
            else:
                _chroma_client = chromadb.Client()  # In-memory (ephemeral)
                logger.info("[RAG] ChromaDB client initialized (in-memory).")
        except ImportError:
            raise ImportError(
                "chromadb is not installed. Run: pip install chromadb"
            )
    return _chroma_client


def _get_embedding_model():
    """Lazily load the sentence-transformers embedding model."""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("[RAG] Loading sentence-transformers model (all-MiniLM-L6-v2)...")
            _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("[RAG] Embedding model loaded.")
        except ImportError:
            raise ImportError(
                "sentence-transformers is not installed. Run: pip install sentence-transformers"
            )
    return _embedding_model


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
    Build a ChromaDB vector collection for a given session.

    Chunks the resume text, embeds each chunk with all-MiniLM-L6-v2,
    and stores vectors in an in-memory ChromaDB collection.

    Args:
        session_id: Unique session identifier (used as collection key).
        resume_text: Full extracted resume text.

    Returns:
        True if store was built successfully, False otherwise.
    """
    try:
        client = _get_chroma_client()
        model = _get_embedding_model()

        collection_name = f"resume_{session_id[:16].replace('-', '_')}"

        # Delete existing collection for this session (idempotent re-upload)
        try:
            client.delete_collection(collection_name)
        except Exception:
            pass

        collection = client.create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )

        chunks = chunk_resume_text(resume_text)
        if not chunks:
            logger.warning("[RAG] No chunks created — resume text may be empty.")
            return False

        embeddings = model.encode(chunks, show_progress_bar=False).tolist()

        collection.add(
            documents=chunks,
            embeddings=embeddings,
            ids=[f"{collection_name}_chunk_{i}" for i in range(len(chunks))]
        )

        _session_collections[session_id] = collection_name
        logger.info(f"[RAG] Built store for session {session_id[:8]}... with {len(chunks)} chunks.")
        return True

    except Exception as e:
        logger.error(f"[RAG] Failed to build resume store: {e}")
        return False


def query_resume_store(session_id: str, query: str, top_k: int = 3) -> str:
    """
    Retrieve the most semantically relevant resume chunks for a query.

    Args:
        session_id: The session whose resume store to query.
        query: The query string (e.g. "Python skills", "work experience").
        top_k: Number of top chunks to return.

    Returns:
        Concatenated relevant resume context string, or empty string if unavailable.
    """
    try:
        if session_id not in _session_collections:
            logger.warning(f"[RAG] No store found for session {session_id[:8]}...")
            return ""

        client = _get_chroma_client()
        model = _get_embedding_model()

        collection_name = _session_collections[session_id]
        collection = client.get_collection(collection_name)

        query_embedding = model.encode([query], show_progress_bar=False).tolist()
        results = collection.query(
            query_embeddings=query_embedding,
            n_results=min(top_k, collection.count())
        )

        docs = results.get("documents", [[]])[0]
        context = "\n\n".join(docs)
        logger.info(f"[RAG] Retrieved {len(docs)} chunks for query: '{query[:50]}'")
        return context

    except Exception as e:
        logger.error(f"[RAG] Query failed: {e}")
        return ""


def delete_resume_store(session_id: str) -> bool:
    """
    Remove the ChromaDB collection for a session (cleanup on session end).

    Args:
        session_id: The session to clean up.

    Returns:
        True if deleted, False if not found or error.
    """
    try:
        if session_id not in _session_collections:
            return False
        client = _get_chroma_client()
        collection_name = _session_collections.pop(session_id)
        client.delete_collection(collection_name)
        logger.info(f"[RAG] Deleted store for session {session_id[:8]}...")
        return True
    except Exception as e:
        logger.error(f"[RAG] Failed to delete store: {e}")
        return False


def get_resume_context(session_id: str, query: str, top_k: int = 3) -> str:
    """
    Convenience wrapper: retrieves relevant resume context for a query.
    Returns empty string gracefully if RAG store is unavailable.
    """
    return query_resume_store(session_id, query, top_k)
