"""
Voice Router — FastAPI routes for voice-enabled interview.

Endpoints:
    POST /voice/transcribe   — Convert audio to text (STT)
    POST /voice/synthesize   — Convert text to audio (TTS)
    POST /voice/answer       — Full pipeline: transcribe + evaluate + next question
"""

import logging
import json
import re
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from typing import Optional
from memory.short_term import ConversationBuffer

logger = logging.getLogger("CareerLens.Voice.Router")

router = APIRouter()


class SynthesizeRequest(BaseModel):
    text: str
    session_id: Optional[str] = None


class VoiceAnswerRequest(BaseModel):
    session_id: str
    question: str
    transcribed_text: str
    question_index: int = 0


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Transcribe an uploaded audio file to text.

    Args:
        audio: Audio file (webm, wav, mp3, ogg).

    Returns:
        JSON with {"text": "transcribed text", "duration_ms": int}
    """
    logger.info(f"[VoiceRouter] Transcribe request: {audio.filename}, content_type={audio.content_type}")

    if not audio:
        raise HTTPException(status_code=400, detail="No audio file provided.")

    try:
        from voice.stt import transcribe_audio as do_transcribe

        audio_bytes = await audio.read()
        if len(audio_bytes) == 0:
            raise HTTPException(status_code=400, detail="Audio file is empty.")

        # Determine audio format from content type or filename
        content_type = (audio.content_type or "") + " " + (audio.filename or "")
        if "webm" in content_type:
            fmt = "webm"
        elif "wav" in content_type:
            fmt = "wav"
        elif "mp3" in content_type or "mpeg" in content_type:
            fmt = "mp3"
        elif "ogg" in content_type:
            fmt = "ogg"
        elif "mp4" in content_type or "m4a" in content_type:
            fmt = "mp4"
        else:
            fmt = "webm"  # Default for browser MediaRecorder

        text = await run_in_threadpool(do_transcribe, audio_bytes, fmt)

        logger.info(f"[VoiceRouter] Transcribed {len(audio_bytes)} bytes → '{text[:80]}'")
        return {"text": text, "char_count": len(text), "success": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[VoiceRouter] Transcription failed: {e}")
        raise HTTPException(status_code=503, detail=f"Speech-to-text service unavailable: {str(e)[:300]}")


@router.post("/synthesize")
def synthesize_speech(request: SynthesizeRequest):
    """
    Convert text to speech audio.

    Args:
        request: SynthesizeRequest with text to speak.

    Returns:
        Audio bytes (FLAC/WAV) as binary response.
    """
    logger.info(f"[VoiceRouter] Synthesize request: '{request.text[:60]}...'")

    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is empty.")

    try:
        from voice.tts import synthesize_speech as do_synthesize

        audio_bytes = do_synthesize(request.text)

        if not audio_bytes:
            raise HTTPException(status_code=500, detail="TTS returned empty audio.")

        logger.info(f"[VoiceRouter] Synthesized {len(audio_bytes)} bytes of audio.")
        return Response(
            content=audio_bytes,
            media_type="audio/flac",
            headers={"Content-Disposition": "inline; filename=speech.flac"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[VoiceRouter] TTS failed: {e}")
        raise HTTPException(status_code=503, detail=f"Speech synthesis unavailable: {str(e)[:300]}")


def _parse_evaluation(text: str) -> dict:
    """Extract the JSON object from an LLM reply (tolerates code fences / extra prose)."""
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not match:
        raise ValueError("no JSON object in LLM reply")
    data = json.loads(match.group(0))
    try:
        score = float(data.get("score", 5))
    except (TypeError, ValueError):
        score = 5
    return {
        "score": max(0, min(10, round(score))),
        "feedback": str(data.get("feedback") or "Answer recorded."),
        "key_point_missed": str(data.get("key_point_missed") or ""),
    }


DEMO_QUESTIONS = [
    "Tell me about yourself and your background in software development.",
    "Describe a challenging project you worked on and how you overcame obstacles.",
    "What are your strongest technical skills and how have you applied them?",
    "How do you approach debugging a complex issue in production?",
    "Where do you see yourself in the next 3-5 years in your career?",
]


@router.post("/answer")
def process_voice_answer(req: VoiceAnswerRequest, request: Request):
    """
    Process a transcribed voice answer: evaluate it, store it, and return the next question.
    Runs in a worker thread (sync def) so the slow LLM call never blocks other requests.
    """
    logger.info(f"[VoiceRouter] Voice answer for session {req.session_id[:8]}..., Q#{req.question_index}")
    answer_text = (req.transcribed_text or "").strip()

    # 1. Evaluate (best-effort — never lose the answer because the LLM is down)
    if not answer_text:
        evaluation = {
            "score": 0,
            "feedback": "No answer was captured for this question.",
            "key_point_missed": "",
        }
    else:
        try:
            from models.llm import generate_text

            eval_prompt = f"""You are a technical interviewer.

Question asked: {req.question}

Candidate's answer: {answer_text}

Provide brief feedback (2-3 sentences) and a score out of 10.

Return JSON only:
{{"score": 7, "feedback": "...", "key_point_missed": "..."}}"""
            evaluation = _parse_evaluation(generate_text(eval_prompt))
        except Exception as e:
            logger.error(f"[VoiceRouter] Live evaluation failed: {e}")
            evaluation = {
                "score": None,
                "feedback": "Your answer was saved. Instant AI feedback is unavailable right now; "
                            "the full evaluation will be generated at the end of the interview.",
                "key_point_missed": "",
                "evaluation_error": True,
            }

    # 2. Store the answer in the real session (restored from MongoDB after a restart)
    db = getattr(request.app.state, "db", None)
    get_session = getattr(request.app.state, "get_session", None)
    session = None
    if req.session_id and req.session_id != "voice_demo" and get_session is not None:
        try:
            session = get_session(req.session_id)
        except HTTPException:
            session = None

    next_question = None
    is_completed = False
    question_index = req.question_index

    if session is not None and session.get("questions"):
        questions = session["questions"]
        question_index = session.get("current_question_index", 0)
        if question_index >= len(questions):
            raise HTTPException(status_code=400, detail="Interview already completed.")
        question = questions[question_index]

        session["answers"].append(answer_text)
        session["qa_pairs"].append({"question": question, "answer": answer_text})
        if "short_term_memory" not in session:
            session["short_term_memory"] = ConversationBuffer(max_turns=5)
        session["short_term_memory"].add_turn(question, answer_text)
        session["current_question_index"] = question_index + 1

        if db is not None:
            try:
                db.answers.insert_one({
                    "interviewId": req.session_id,
                    "question": question,
                    "answer": answer_text,
                    "questionNumber": question_index + 1,
                    "createdAt": datetime.now(),
                    "updatedAt": datetime.now(),
                })
            except Exception as e:
                logger.error(f"Failed to save voice answer to DB: {e}")

        if session["current_question_index"] < len(questions):
            next_question = questions[session["current_question_index"]]
        else:
            is_completed = True
    else:
        # Demo mode (no real session)
        next_idx = req.question_index + 1
        if next_idx < len(DEMO_QUESTIONS):
            next_question = DEMO_QUESTIONS[next_idx]
        else:
            is_completed = True

    return {
        "success": True,
        "question_index": question_index,
        "evaluation": evaluation,
        "session_id": req.session_id,
        "next_question": next_question,
        "is_completed": is_completed,
    }
