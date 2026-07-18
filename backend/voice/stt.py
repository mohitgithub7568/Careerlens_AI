"""
Speech-to-Text (STT) — Whisper-based audio transcription.

Supports two backends:
1. Local Whisper (whisper library) — runs on CPU/GPU, ~74MB model
2. HuggingFace Inference API — fallback, requires internet
"""

import logging
import os
import tempfile
from typing import Optional

logger = logging.getLogger("CareerLens.Voice.STT")

# Lazily loaded Whisper model
_whisper_model = None
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")


def _get_whisper_model():
    """Lazy-load the Whisper model on first use."""
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper
            logger.info(f"[STT] Loading Whisper model: {WHISPER_MODEL_SIZE}...")
            _whisper_model = whisper.load_model(WHISPER_MODEL_SIZE)
            logger.info("[STT] Whisper model loaded.")
        except ImportError:
            logger.warning("[STT] openai-whisper not installed. Will use HF API fallback.")
            _whisper_model = "hf_fallback"
    return _whisper_model


def transcribe_audio_local(audio_bytes: bytes, audio_format: str = "webm") -> str:
    """
    Transcribe audio bytes using local Whisper model.

    Args:
        audio_bytes: Raw audio bytes (webm/wav/mp3).
        audio_format: File extension for temp file.

    Returns:
        Transcribed text string.
    """
    model = _get_whisper_model()

    if model == "hf_fallback":
        return transcribe_audio_hf(audio_bytes)

    # Write to temp file (Whisper requires a file path)
    suffix = f".{audio_format}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path, language="en", fp16=False)
        text = result.get("text", "").strip()
        logger.info(f"[STT] Transcribed {len(text)} chars: '{text[:80]}...'")
        return text
    except Exception as e:
        logger.error(f"[STT] Whisper transcription failed: {e}")
        raise RuntimeError(f"Transcription failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def transcribe_audio_hf(audio_bytes: bytes) -> str:
    """
    Transcribe audio using HuggingFace Inference API (fallback).

    Args:
        audio_bytes: Raw audio bytes.

    Returns:
        Transcribed text string.
    """
    import requests
    import os

    api_token = os.environ.get("HUGGINGFACEHUB_API_TOKEN", "")
    if not api_token:
        raise ValueError("HUGGINGFACEHUB_API_TOKEN not set for HF ASR fallback.")

    url = "https://api-inference.huggingface.co/models/openai/whisper-base"
    headers = {"Authorization": f"Bearer {api_token}"}

    try:
        response = requests.post(url, headers=headers, data=audio_bytes, timeout=30)
        response.raise_for_status()
        result = response.json()
        text = result.get("text", "").strip()
        logger.info(f"[STT] HF ASR transcribed: '{text[:80]}...'")
        return text
    except Exception as e:
        logger.error(f"[STT] HF ASR failed: {e}")
        raise RuntimeError(f"HF ASR transcription failed: {str(e)}")


def transcribe_audio(audio_bytes: bytes, audio_format: str = "webm") -> str:
    """
    Main entry point for audio transcription.
    Tries local Whisper first, falls back to HF API.

    Args:
        audio_bytes: Raw audio bytes.
        audio_format: Audio format extension.

    Returns:
        Transcribed text string.
    """
    if not audio_bytes:
        return ""

    try:
        return transcribe_audio_local(audio_bytes, audio_format)
    except Exception as e:
        logger.warning(f"[STT] Local transcription failed, trying HF fallback: {e}")
        try:
            return transcribe_audio_hf(audio_bytes)
        except Exception as e2:
            logger.error(f"[STT] All transcription methods failed: {e2}")
            return ""
