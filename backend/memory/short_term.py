"""
Short-Term Memory — Conversation Buffer

Maintains a rolling window of Q&A turns within a single interview session.
Lives inside the LangGraph GraphState and is passed between nodes.
"""

import logging
from typing import Optional

logger = logging.getLogger("CareerLens.Memory.ShortTerm")


class ConversationBuffer:
    """
    A rolling buffer of conversation turns (question + answer pairs).

    Keeps the most recent `max_turns` entries to avoid overloading
    the LLM context window.
    """

    def __init__(self, max_turns: int = 5):
        self.max_turns = max_turns
        self._history: list[dict] = []

    def add_turn(self, question: str, answer: str) -> None:
        """Append a Q&A turn to the buffer."""
        self._history.append({"question": question, "answer": answer})
        # Trim to max_turns
        if len(self._history) > self.max_turns:
            self._history = self._history[-self.max_turns:]
        logger.debug(f"[ShortTermMemory] Added turn. Buffer size: {len(self._history)}")

    def get_context(self, max_turns: Optional[int] = None) -> str:
        """
        Format recent history as a readable string for LLM context.

        Args:
            max_turns: Optional override for how many turns to include.

        Returns:
            Formatted conversation history string.
        """
        limit = max_turns or self.max_turns
        recent = self._history[-limit:]

        if not recent:
            return ""

        lines = ["--- Recent Conversation History ---"]
        for i, turn in enumerate(recent, 1):
            lines.append(f"Q{i}: {turn['question']}")
            lines.append(f"A{i}: {turn['answer']}")
        lines.append("-----------------------------------")

        return "\n".join(lines)

    def get_raw_history(self) -> list[dict]:
        """Return raw list of turn dicts for serialization."""
        return list(self._history)

    def load_from_list(self, history: list[dict]) -> None:
        """Restore buffer from a serialized list (e.g., from GraphState)."""
        self._history = history[-self.max_turns:]

    def is_empty(self) -> bool:
        return len(self._history) == 0

    def __len__(self) -> int:
        return len(self._history)

    def __repr__(self) -> str:
        return f"ConversationBuffer(turns={len(self._history)}, max={self.max_turns})"
