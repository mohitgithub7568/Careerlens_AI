"""
Speech-to-Text (STT) — Whisper transcription.

Backends, tried in order:
1. Groq Whisper (OpenAI-compatible, free tier) — when GROQ_API_KEY is set
2. HuggingFace router (whisper-large-v3-turbo) — when HUGGINGFACEHUB_API_TOKEN is set
3. Local openai-whisper — only when ENABLE_LOCAL_WHISPER=1 (needs ~1GB RAM + ffmpeg;
   it crashes Render's free 512MB instance, so it is off by default)
"""

import logging
import os
import tempfile

import requests

logger = logging.getLogger("CareerLens.Voice.STT")

_whisper_model = None
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")

GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
HF_STT_MODEL = os.environ.get("HF_STT_MODEL", "openai/whisper-large-v3-turbo")

MIME_TYPES = {
    "webm": "audio/webm",
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
}


class TranscriptionError(RuntimeError):
    pass


def transcribe_audio_groq(audio_bytes: bytes, audio_format: str = "webm") -> str:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise TranscriptionError("GROQ_API_KEY not set")

    model = os.environ.get("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    files = {"file": (f"audio.{audio_format}", audio_bytes, MIME_TYPES.get(audio_format, "audio/webm"))}
    data = {"model": model, "language": "en", "response_format": "json"}
    response = requests.post(
        GROQ_STT_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        files=files,
        data=data,
        timeout=60,
    )
    if response.status_code >= 400:
        raise TranscriptionError(f"Groq STT {response.status_code}: {response.text[:300]}")
    return (response.json().get("text") or "").strip()


def transcribe_audio_hf(audio_bytes: bytes, audio_format: str = "webm") -> str:
    api_token = os.environ.get("HUGGINGFACEHUB_API_TOKEN", "").strip()
    if not api_token:
        raise TranscriptionError("HUGGINGFACEHUB_API_TOKEN not set")

    url = f"https://router.huggingface.co/hf-inference/models/{HF_STT_MODEL}"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": MIME_TYPES.get(audio_format, "audio/webm"),
    }
    response = requests.post(url, headers=headers, data=audio_bytes, timeout=60)
    if response.status_code >= 400:
        raise TranscriptionError(f"HF STT {response.status_code}: {response.text[:300]}")
    return (response.json().get("text") or "").strip()


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        import whisper  # optional dependency

        logger.info(f"[STT] Loading local Whisper model: {WHISPER_MODEL_SIZE}...")
        _whisper_model = whisper.load_model(WHISPER_MODEL_SIZE)
    return _whisper_model


def transcribe_audio_local(audio_bytes: bytes, audio_format: str = "webm") -> str:
    model = _get_whisper_model()
    with tempfile.NamedTemporaryFile(suffix=f".{audio_format}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        result = model.transcribe(tmp_path, language="en", fp16=False)
        return (result.get("text") or "").strip()
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def transcribe_audio(audio_bytes: bytes, audio_format: str = "webm") -> str:
    """
    Transcribe audio, trying each configured backend in turn.
    Raises TranscriptionError with the collected reasons if every backend fails.
    """
    if not audio_bytes:
        return ""

    backends = []
    if os.environ.get("GROQ_API_KEY"):
        backends.append(("groq", transcribe_audio_groq))
    if os.environ.get("HUGGINGFACEHUB_API_TOKEN"):
        backends.append(("huggingface", transcribe_audio_hf))
    if os.environ.get("ENABLE_LOCAL_WHISPER", "").lower() in ("1", "true", "yes"):
        backends.append(("local-whisper", transcribe_audio_local))

    if not backends:
        raise TranscriptionError("No speech-to-text backend configured (set GROQ_API_KEY).")

    errors = []
    for name, fn in backends:
        try:
            text = fn(audio_bytes, audio_format)
            logger.info(f"[STT] {name} transcribed {len(text)} chars")
            return text
        except Exception as e:
            logger.warning(f"[STT] {name} failed: {e}")
            errors.append(f"{name}: {e}")

    raise TranscriptionError("; ".join(errors))
