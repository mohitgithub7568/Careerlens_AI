import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL, readErrorMessage } from '../services/api';
import { speakText, cancelSpeech } from '../utils/speech';
import './VoiceInterviewPage.css';

const API_BASE = API_BASE_URL;

// Sample questions for demo (real ones come from the backend session)
const DEMO_QUESTIONS = [
  "Tell me about yourself and your background in software development.",
  "Describe a challenging project you worked on and how you overcame obstacles.",
  "What are your strongest technical skills and how have you applied them?",
  "How do you approach debugging a complex issue in production?",
  "Where do you see yourself in the next 3-5 years in your career?",
];

const getSpeechRecognition = () =>
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;

// Pick a recording format the current browser supports (Safari only does mp4).
const pickRecorderFormat = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ];
  for (const [mime, ext] of candidates) {
    if (MediaRecorder.isTypeSupported?.(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
};

const MIC_ERRORS = {
  'not-allowed': 'Microphone access was blocked. Allow the microphone in your browser settings and try again.',
  'service-not-allowed': 'Microphone access was blocked. Allow the microphone in your browser settings and try again.',
  'audio-capture': 'No microphone was found. Please connect a microphone and try again.',
  network: 'Speech recognition needs an internet connection. Please check your connection.',
};

export default function VoiceInterviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const stateSessionId = location.state?.sessionId || 'voice_demo';
  const stateQuestions = location.state?.questions;
  const isRealSession = stateSessionId !== 'voice_demo';

  const [phase, setPhase] = useState('ready'); // ready | listening | processing | speaking | feedback | complete
  const [questions, setQuestions] = useState(
    Array.isArray(stateQuestions) && stateQuestions.length > 0 ? stateQuestions : DEMO_QUESTIONS
  );
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [sessionLog, setSessionLog] = useState([]);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [completeNote, setCompleteNote] = useState('');
  const [volume, setVolume] = useState(0);

  // Load the real session's questions once (when we were not handed them directly).
  useEffect(() => {
    if (!isRealSession) return;
    if (Array.isArray(stateQuestions) && stateQuestions.length > 0) return;
    let cancelled = false;
    setPhase('processing');
    fetch(`${API_BASE}/voice/start-session/${encodeURIComponent(stateSessionId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readErrorMessage(res, 'Could not load interview'));
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.success && Array.isArray(data.questions) && data.questions.length > 0) {
          setQuestions(data.questions);
          setCurrentQIndex(Math.min(data.current_question_index || 0, data.questions.length - 1));
        }
      })
      .catch((err) => {
        if (!cancelled) setAudioError(err.message || 'Could not load interview questions.');
      })
      .finally(() => {
        if (!cancelled) setPhase('ready');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateSessionId]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const browserTextRef = useRef('');
  const recordingActiveRef = useRef(false);
  const ttsAudioRef = useRef(null);

  const currentQuestion = questions[currentQIndex];
  const isLastQuestion = currentQIndex >= questions.length - 1;

  // Always-fresh values for async callbacks (MediaRecorder.onstop fires later).
  const latestRef = useRef({});
  latestRef.current = { currentQuestion, currentQIndex, stateSessionId };

  // ── Audio Visualizer ──────────────────────────────────────────────
  const startVisualizer = useCallback((stream) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      audioCtxRef.current.resume?.();
      sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      sourceRef.current.connect(analyserRef.current);

      const dataArr = new Uint8Array(analyserRef.current.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArr);
        const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
        setVolume(Math.min(100, avg * 2));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Visualizer is cosmetic only.
    }
  }, []);

  const stopVisualizer = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    try {
      sourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    sourceRef.current = null;
    analyserRef.current = null;
    setVolume(0);
  }, []);

  // ── Speak Question (browser TTS first, server TTS as fallback) ────
  const speakQuestion = useCallback(async (text) => {
    if (!text) return;
    setAudioError('');
    if ('speechSynthesis' in window) {
      setPhase('speaking');
      speakText(text, {
        onEnd: () => setPhase((p) => (p === 'speaking' ? 'ready' : p)),
      });
      return;
    }

    setPhase('speaking');
    setIsLoadingAudio(true);
    try {
      const res = await fetch(`${API_BASE}/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Text-to-speech failed'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        setPhase((p) => (p === 'speaking' ? 'ready' : p));
        setIsLoadingAudio(false);
      };
      audio.onended = done;
      audio.onerror = () => {
        done();
        setAudioError('Audio playback failed. Please read the question above.');
      };
      await audio.play();
      setIsLoadingAudio(false);
    } catch (err) {
      console.error('TTS failed:', err);
      setAudioError('Voice playback is not available in this browser — please read the question above.');
      setPhase('ready');
      setIsLoadingAudio(false);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    cancelSpeech();
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setIsLoadingAudio(false);
  }, []);

  // ── Transcribe + Evaluate ─────────────────────────────────────────
  const transcribeAndEvaluate = useCallback(async (audioBlob, fileExt) => {
    const { currentQuestion: question, currentQIndex: qIndex, stateSessionId: sid } = latestRef.current;
    try {
      // Step 1: use the browser's live transcript if it heard anything; otherwise ask the server.
      let text = browserTextRef.current.trim();
      if (!text) {
        if (!audioBlob || audioBlob.size === 0) {
          throw new Error("We couldn't hear anything. Check your microphone and try again.");
        }
        const formData = new FormData();
        formData.append('audio', audioBlob, `answer.${fileExt || 'webm'}`);
        const sttRes = await fetch(`${API_BASE}/voice/transcribe`, { method: 'POST', body: formData });
        if (!sttRes.ok) {
          const msg = await readErrorMessage(sttRes, 'Transcription failed');
          throw new Error(
            getSpeechRecognition()
              ? "We couldn't hear anything. Please speak clearly and try again."
              : `Speech-to-text failed: ${msg}. Try Chrome or Edge for built-in speech recognition.`
          );
        }
        const sttData = await sttRes.json();
        text = (sttData.text || '').trim();
      }
      if (!text) {
        throw new Error("We couldn't hear anything. Please speak a bit louder and try again.");
      }
      setTranscript(text);

      // Step 2: Evaluate + store
      const evalRes = await fetch(`${API_BASE}/voice/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sid,
          question,
          transcribed_text: text,
          question_index: qIndex,
        }),
      });
      if (!evalRes.ok) throw new Error(await readErrorMessage(evalRes, 'Could not save your answer'));
      const evalData = await evalRes.json();
      const evalResult = evalData?.evaluation || { score: null, feedback: 'Answer recorded.', key_point_missed: '' };
      setFeedback(evalResult);

      setSessionLog((prev) => [
        ...prev,
        { question, answer: text, score: evalResult.score, feedback: evalResult.feedback },
      ]);

      setPhase('feedback');
    } catch (err) {
      console.error('Transcribe/Evaluate failed:', err);
      setAudioError(err.message || 'Processing failed. Please try again.');
      setPhase('ready');
    }
  }, []);

  // ── Browser speech recognition (live transcript) ──────────────────
  const startBrowserRecognition = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      // Text finalised by earlier runs (Chrome ends a run after a pause and we restart it).
      let committed = '';
      rec.onresult = (event) => {
        let finalText = '';
        let interim = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const t = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) finalText += `${t} `;
          else interim += t;
        }
        browserTextRef.current = `${committed} ${finalText}`.trim();
        setLiveTranscript(`${committed} ${finalText}${interim}`.trim());
      };
      rec.onerror = (e) => {
        if (MIC_ERRORS[e.error]) setAudioError(MIC_ERRORS[e.error]);
      };
      rec.onend = () => {
        if (recordingActiveRef.current && recognitionRef.current === rec) {
          committed = browserTextRef.current;
          try {
            rec.start();
          } catch {
            // ignore
          }
        }
      };
      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.warn('Speech recognition unavailable:', err);
      recognitionRef.current = null;
    }
  }, []);

  const stopBrowserRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  // ── Start Recording ───────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setAudioError('');
    setTranscript('');
    setLiveTranscript('');
    setFeedback(null);
    browserTextRef.current = '';
    stopSpeaking();

    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioError('Voice recording is not supported here. Use Chrome or Edge over HTTPS.');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error(err);
      setAudioError(MIC_ERRORS[err?.name === 'NotFoundError' ? 'audio-capture' : 'not-allowed']);
      return;
    }

    streamRef.current = stream;
    startVisualizer(stream);
    recordingActiveRef.current = true;

    const format = pickRecorderFormat();
    if (format) {
      try {
        const recorder = format.mime ? new MediaRecorder(stream, { mimeType: format.mime }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || format.mime || 'audio/webm' });
          // Give the browser recognizer a moment to deliver its final result.
          setTimeout(() => transcribeAndEvaluate(blob, format.ext), 400);
        };
        recorder.start(250);
      } catch (err) {
        console.warn('MediaRecorder failed, relying on browser speech recognition:', err);
        mediaRecorderRef.current = null;
      }
    }

    startBrowserRecognition();
    setPhase('listening');
  }, [startVisualizer, startBrowserRecognition, stopSpeaking, transcribeAndEvaluate]);

  // ── Stop Recording ────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (!recordingActiveRef.current) return;
    recordingActiveRef.current = false;
    setPhase('processing');
    stopBrowserRecognition();
    stopVisualizer();
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state === 'recording') {
      recorder.stop(); // onstop → transcribeAndEvaluate
    } else {
      setTimeout(() => transcribeAndEvaluate(null, 'webm'), 400);
    }
  }, [stopBrowserRecognition, stopVisualizer, transcribeAndEvaluate]);

  // ── Next Question ─────────────────────────────────────────────────
  const handleNext = useCallback(async () => {
    stopSpeaking();
    if (!isLastQuestion) {
      setCurrentQIndex((i) => i + 1);
      setTranscript('');
      setLiveTranscript('');
      setFeedback(null);
      setAudioError('');
      setPhase('ready');
      return;
    }

    if (!isRealSession) {
      setPhase('complete');
      return;
    }

    // Compile the full evaluation for the real interview.
    setPhase('processing');
    try {
      const res = await fetch(`${API_BASE}/get-feedback?session_id=${encodeURIComponent(stateSessionId)}`);
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Could not generate the final evaluation'));
      navigate('/evaluation', { state: { sessionId: stateSessionId } });
    } catch (err) {
      console.error('Failed to compile feedback:', err);
      setCompleteNote(`Your answers are saved, but the final evaluation could not be generated: ${err.message}`);
      setPhase('complete');
    }
  }, [isLastQuestion, isRealSession, stateSessionId, navigate, stopSpeaking]);

  // ── Restart ───────────────────────────────────────────────────────
  const handleRestart = () => {
    if (isRealSession) {
      navigate('/interviews');
      return;
    }
    setCurrentQIndex(0);
    setTranscript('');
    setLiveTranscript('');
    setFeedback(null);
    setSessionLog([]);
    setCompleteNote('');
    setPhase('ready');
    setAudioError('');
  };

  // ── Cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      recordingActiveRef.current = false;
      stopBrowserRecognition();
      stopVisualizer();
      cancelSpeech();
      if (ttsAudioRef.current) ttsAudioRef.current.pause();
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null;
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    };
  }, [stopBrowserRecognition, stopVisualizer]);

  // ── Waveform bars ─────────────────────────────────────────────────
  const waveformBars = Array.from({ length: 20 }, (_, i) => {
    const barHeight = phase === 'listening'
      ? Math.max(8, (volume + Math.sin(Date.now() / 200 + i) * 20) * (0.5 + Math.random() * 0.5))
      : 8;
    return barHeight;
  });

  if (phase === 'complete') {
    const scored = sessionLog.filter((e) => typeof e.score === 'number');
    const avgScore = scored.length > 0
      ? Math.round((scored.reduce((a, b) => a + b.score, 0) / scored.length) * 10)
      : 0;

    return (
      <div className="vi-container">
        <div className="vi-complete-card">
          <div className="vi-complete-icon">🎉</div>
          <h1 className="vi-complete-title">Interview Complete!</h1>
          <div className="vi-score-ring">
            <svg viewBox="0 0 100 100" className="vi-ring-svg">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#1e1e2e" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="45" fill="none"
                stroke="url(#scoreGrad)" strokeWidth="8"
                strokeDasharray={`${avgScore * 2.83} 283`}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
              />
              <defs>
                <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#6c63ff" />
                  <stop offset="100%" stopColor="#48cfad" />
                </linearGradient>
              </defs>
            </svg>
            <div className="vi-ring-label">
              <span className="vi-ring-score">{avgScore}</span>
              <span className="vi-ring-unit">/100</span>
            </div>
          </div>
          <p className="vi-complete-subtitle">
            {scored.length > 0 ? 'Average Score' : 'Instant scores were not available for this session'}
          </p>
          {completeNote && <p className="vi-error">{completeNote}</p>}

          <div className="vi-session-log">
            <h3>Session Summary</h3>
            {sessionLog.map((entry, i) => (
              <div key={i} className="vi-log-entry">
                <div className="vi-log-q">Q{i + 1}: {entry.question}</div>
                <div className="vi-log-score">Score: {typeof entry.score === 'number' ? `${entry.score}/10` : '—'}</div>
                <div className="vi-log-fb">{entry.feedback}</div>
              </div>
            ))}
          </div>

          <button className="vi-btn-primary" onClick={handleRestart}>
            {isRealSession ? 'Back to Interviews' : 'Start New Interview'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vi-container">
      {/* Header */}
      <div className="vi-header">
        <h1 className="vi-title">🎙️ Voice Interview</h1>
        <p className="vi-subtitle">Answer questions using your voice — AI evaluates in real time</p>
        <div className="vi-progress-bar">
          <div
            className="vi-progress-fill"
            style={{ width: `${((currentQIndex + (phase === 'feedback' ? 1 : 0)) / questions.length) * 100}%` }}
          />
        </div>
        <span className="vi-progress-label">Question {currentQIndex + 1} of {questions.length}</span>
      </div>

      {/* Question Card */}
      <div className={`vi-question-card ${phase === 'speaking' ? 'vi-speaking' : ''}`}>
        <div className="vi-question-badge">Q{currentQIndex + 1}</div>
        <p className="vi-question-text">{currentQuestion}</p>
        <button
          className="vi-speak-btn"
          onClick={() => speakQuestion(currentQuestion)}
          disabled={!currentQuestion || phase === 'speaking' || phase === 'listening' || phase === 'processing'}
          title="Listen to question"
        >
          {isLoadingAudio ? '⏳' : '🔊'} {isLoadingAudio ? 'Loading...' : 'Play Question'}
        </button>
      </div>

      {/* Microphone + Waveform */}
      <div className="vi-mic-section">
        <div className={`vi-waveform ${phase === 'listening' ? 'vi-waveform-active' : ''}`}>
          {waveformBars.map((h, i) => (
            <div
              key={i}
              className="vi-bar"
              style={{
                height: `${Math.max(8, h)}px`,
                animationDelay: `${i * 50}ms`,
              }}
            />
          ))}
        </div>

        <div className={`vi-mic-btn-wrap ${phase === 'listening' ? 'vi-recording' : ''}`}>
          {phase === 'listening' ? (
            <button className="vi-mic-btn vi-mic-stop" onClick={stopRecording} id="voice-stop-btn">
              <span className="vi-mic-icon">⬛</span>
              <span className="vi-mic-label">Stop Recording</span>
            </button>
          ) : phase === 'processing' ? (
            <div className="vi-processing">
              <div className="vi-spinner" />
              <span>{currentQuestion ? 'Processing...' : 'Loading...'}</span>
            </div>
          ) : (
            <button
              className="vi-mic-btn vi-mic-start"
              onClick={startRecording}
              disabled={!currentQuestion || phase === 'feedback'}
              id="voice-start-btn"
            >
              <span className="vi-mic-icon">🎤</span>
              <span className="vi-mic-label">Start Speaking</span>
            </button>
          )}
        </div>

        {audioError && <p className="vi-error">{audioError}</p>}

        <p className="vi-phase-label">
          {phase === 'ready' && 'Press the mic button and speak your answer'}
          {phase === 'listening' && '🔴 Recording — press Stop when done'}
          {phase === 'processing' && 'Processing your answer...'}
          {phase === 'speaking' && '🔊 AI is reading the question...'}
          {phase === 'feedback' && 'Answer recorded — review feedback below'}
        </p>
      </div>

      {/* Live transcript while recording */}
      {phase === 'listening' && liveTranscript && (
        <div className="vi-transcript-card">
          <h3 className="vi-section-label">🎧 Hearing you...</h3>
          <p className="vi-transcript-text">{liveTranscript}</p>
        </div>
      )}

      {/* Transcript */}
      {transcript && (
        <div className="vi-transcript-card">
          <h3 className="vi-section-label">📝 Your Answer (Transcribed)</h3>
          <p className="vi-transcript-text">{transcript}</p>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className="vi-feedback-card">
          <div className="vi-feedback-header">
            <h3 className="vi-section-label">🤖 AI Feedback</h3>
            {typeof feedback.score === 'number' && (
              <div className={`vi-score-badge ${
                feedback.score >= 8 ? 'vi-score-high' :
                feedback.score >= 5 ? 'vi-score-mid' : 'vi-score-low'
              }`}>
                {feedback.score}/10
              </div>
            )}
          </div>
          <p className="vi-feedback-text">{feedback.feedback}</p>
          {feedback.key_point_missed && (
            <div className="vi-missed">
              <span className="vi-missed-label">💡 Key Point to Include:</span>
              <span className="vi-missed-text">{feedback.key_point_missed}</span>
            </div>
          )}

          <button className="vi-btn-primary" onClick={handleNext} id="voice-next-btn">
            {isLastQuestion ? '🏁 Finish Interview' : 'Next Question →'}
          </button>
        </div>
      )}
    </div>
  );
}
