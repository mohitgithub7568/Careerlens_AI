"""
Voice Router — FastAPI routes for voice-enabled interview.

Endpoints:
    POST /voice/transcribe   — Convert audio to text (STT)
    POST /voice/synthesize   — Convert text to audio (TTS)
    POST /voice/answer       — Full pipeline: transcribe + evaluate + next question
"""

import logging
import json
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
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
        content_type = audio.content_type or ""
        if "webm" in content_type:
            fmt = "webm"
        elif "wav" in content_type:
            fmt = "wav"
        elif "mp3" in content_type or "mpeg" in content_type:
            fmt = "mp3"
        elif "ogg" in content_type:
            fmt = "ogg"
        else:
            fmt = "webm"  # Default for browser MediaRecorder

        text = do_transcribe(audio_bytes, audio_format=fmt)

        logger.info(f"[VoiceRouter] Transcribed {len(audio_bytes)} bytes → '{text[:80]}'")
        return {"text": text, "char_count": len(text), "success": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[VoiceRouter] Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@router.post("/synthesize")
async def synthesize_speech(request: SynthesizeRequest):
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
        raise HTTPException(status_code=500, detail=f"Speech synthesis failed: {str(e)}")


@router.post("/answer")
async def process_voice_answer(req: VoiceAnswerRequest, request: Request):
    """
    Process a transcribed voice answer: evaluate it and prepare the next question.

    This is the main loop endpoint for voice interviews.

    Args:
        req: VoiceAnswerRequest with session context and transcribed answer.
        request: FastAPI Request to access app.state.

    Returns:
        JSON with evaluation feedback and optional next question.
    """
    logger.info(f"[VoiceRouter] Voice answer for session {req.session_id[:8]}..., Q#{req.question_index}")

    try:
        from models.llm import generate_text

        # Quick evaluation of this single answer
        eval_prompt = f"""You are a technical interviewer.

Question asked: {req.question}

Candidate's answer: {req.transcribed_text}

Provide brief feedback (2-3 sentences) and a score out of 10.

Return JSON only:
{{"score": 7, "feedback": "...", "key_point_missed": "..."}}"""

        response = generate_text(eval_prompt)

        # Parse response
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]

        try:
            evaluation = json.loads(text)
        except Exception:
            evaluation = {
                "score": 5,
                "feedback": "Thank you for your answer.",
                "key_point_missed": ""
            }

        # Check if this is a real session in memory
        sessions = getattr(request.app.state, "sessions", {})
        db = getattr(request.app.state, "db", None)
        next_question = None
        is_completed = False

        if req.session_id in sessions:
            session = sessions[req.session_id]
            
            # Store answer in session memory
            session["answers"].append(req.transcribed_text)
            session["qa_pairs"].append({
                "question": req.question,
                "answer": req.transcribed_text,
            })
            
            # Add to short term memory
            if "short_term_memory" not in session:
                session["short_term_memory"] = ConversationBuffer(max_turns=5)
            session["short_term_memory"].add_turn(req.question, req.transcribed_text)
            
            # Update index
            session["current_question_index"] = req.question_index + 1
            
            # Save answer to Mongo
            if db is not None:
                try:
                    db.answers.insert_one({
                        "interviewId": req.session_id,
                        "question": req.question,
                        "answer": req.transcribed_text,
                        "questionNumber": req.question_index + 1,
                        "createdAt": datetime.now(),
                        "updatedAt": datetime.now()
                    })
                except Exception as e:
                    logger.error(f"Failed to save voice answer to DB: {e}")
            
            # Determine next question
            if session["current_question_index"] < len(session["questions"]):
                next_question = session["questions"][session["current_question_index"]]
            else:
                is_completed = True
        else:
            # Fallback/Demo mode
            demo_questions = [
                "Tell me about yourself and your background in software development.",
                "Describe a challenging project you worked on and how you overcame obstacles.",
                "What are your strongest technical skills and how have you applied them?",
                "How do you approach debugging a complex issue in production?",
                "Where do you see yourself in the next 3-5 years in your career?",
            ]
            next_idx = req.question_index + 1
            if next_idx < len(demo_questions):
                next_question = demo_questions[next_idx]
            else:
                is_completed = True

        return {
            "success": True,
            "question_index": req.question_index,
            "evaluation": evaluation,
            "session_id": req.session_id,
            "next_question": next_question,
            "is_completed": is_completed,
        }

    except Exception as e:
        logger.error(f"[VoiceRouter] Voice answer processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
