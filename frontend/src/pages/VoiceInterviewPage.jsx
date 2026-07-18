import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './VoiceInterviewPage.css';

const API_BASE = 'http://localhost:8000';

// Sample questions for demo (real ones come from the backend session)
const DEMO_QUESTIONS = [
  "Tell me about yourself and your background in software development.",
  "Describe a challenging project you worked on and how you overcame obstacles.",
  "What are your strongest technical skills and how have you applied them?",
  "How do you approach debugging a complex issue in production?",
  "Where do you see yourself in the next 3-5 years in your career?",
];

export default function VoiceInterviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const stateSessionId = location.state?.sessionId || 'voice_demo';
  const stateRole = location.state?.role || 'Software Engineer';
  const stateQuestions = location.state?.questions || [];

  const [phase, setPhase] = useState('ready'); // ready | listening | processing | speaking | feedback | complete
  const [questions, setQuestions] = useState(stateQuestions.length > 0 ? stateQuestions : DEMO_QUESTIONS);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [sessionLog, setSessionLog] = useState([]);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (stateQuestions && stateQuestions.length > 0) {
      setQuestions(stateQuestions);
      return;
    }
    if (stateSessionId && stateSessionId !== 'voice_demo') {
      setPhase('processing');
      fetch(`${API_BASE}/voice/start-session/${stateSessionId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.questions && data.questions.length > 0) {
            setQuestions(data.questions);
            setCurrentQIndex(data.current_question_index || 0);
          }
          setPhase('ready');
        })
        .catch(err => {
          console.error("Failed to fetch voice session:", err);
          setPhase('ready');
        });
    }
  }, [stateQuestions, stateSessionId]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);

  const currentQuestion = questions[currentQIndex];
  const isLastQuestion = currentQIndex >= questions.length - 1;

  // ── Audio Visualizer ──────────────────────────────────────────────
  const startVisualizer = useCallback((stream) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const source = audioCtxRef.current.createMediaStreamSource(stream);
    analyserRef.current = audioCtxRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    source.connect(analyserRef.current);

    const dataArr = new Uint8Array(analyserRef.current.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
      setVolume(Math.min(100, avg * 2));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopVisualizer = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setVolume(0);
  }, []);

  // ── Speak Question via TTS ────────────────────────────────────────
  const speakQuestion = useCallback(async (text) => {
    setPhase('speaking');
    setIsLoadingAudio(true);
    setAudioError('');
    try {
      const res = await fetch(`${API_BASE}/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`TTS error: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPhase('ready');
        setIsLoadingAudio(false);
      };
      audio.onerror = () => {
        setAudioError('Audio playback failed. Read the question above.');
        setPhase('ready');
        setIsLoadingAudio(false);
      };
      await audio.play();
    } catch (err) {
      console.error('TTS failed:', err);
      setAudioError('TTS unavailable — please read the question above.');
      setPhase('ready');
      setIsLoadingAudio(false);
    }
  }, []);

  // ── Start Recording ───────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setAudioError('');
    setTranscript('');
    setFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startVisualizer(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopVisualizer();
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        await transcribeAndEvaluate(blob);
      };

      recorder.start(200); // Collect data every 200ms
      setPhase('listening');
    } catch (err) {
      setAudioError('Microphone access denied. Please allow microphone access.');
      console.error(err);
    }
  }, [startVisualizer, stopVisualizer]);

  // ── Stop Recording ────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setPhase('processing');
    }
  }, []);

  // ── Transcribe + Evaluate ─────────────────────────────────────────
  const transcribeAndEvaluate = useCallback(async (audioBlob) => {
    try {
      // Step 1: Transcribe
      const formData = new FormData();
      formData.append('audio', audioBlob, 'answer.webm');
      const sttRes = await fetch(`${API_BASE}/voice/transcribe`, {
        method: 'POST',
        body: formData,
      });
      if (!sttRes.ok) throw new Error(`STT failed: ${sttRes.status}`);
      const sttData = await sttRes.json();
      const text = sttData.text || '';
      setTranscript(text);

      // Step 2: Evaluate
      const evalRes = await fetch(`${API_BASE}/voice/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: stateSessionId,
          question: currentQuestion,
          transcribed_text: text,
          question_index: currentQIndex,
        }),
      });
      const evalData = evalRes.ok ? await evalRes.json() : null;
      const evalResult = evalData?.evaluation || { score: 5, feedback: 'Answer recorded.', key_point_missed: '' };
      setFeedback(evalResult);

      // Save to session log
      setSessionLog(prev => [...prev, {
        question: currentQuestion,
        answer: text,
        score: evalResult.score,
        feedback: evalResult.feedback,
      }]);

      setPhase('feedback');
    } catch (err) {
      console.error('Transcribe/Evaluate failed:', err);
      setAudioError('Processing failed. Please try again.');
      setPhase('ready');
    }
  }, [currentQuestion, currentQIndex]);

  // ── Next Question ─────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (isLastQuestion) {
      if (stateSessionId !== 'voice_demo') {
        setPhase('processing');
        // Compile the feedback
        fetch(`${API_BASE}/get-feedback?session_id=${stateSessionId}`)
          .then(() => {
            navigate('/evaluation', { state: { sessionId: stateSessionId } });
          })
          .catch(err => {
            console.error("Failed to compile feedback:", err);
            setPhase('complete');
          });
      } else {
        setPhase('complete');
      }
    } else {
      setCurrentQIndex(i => i + 1);
      setTranscript('');
      setFeedback(null);
      setPhase('ready');
    }
  }, [isLastQuestion, stateSessionId, navigate]);

  // ── Restart ───────────────────────────────────────────────────────
  const handleRestart = () => {
    setCurrentQIndex(0);
    setTranscript('');
    setFeedback(null);
    setSessionLog([]);
    setPhase('ready');
    setAudioError('');
  };

  // ── Cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopVisualizer();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [stopVisualizer]);

  // ── Waveform bars ─────────────────────────────────────────────────
  const waveformBars = Array.from({ length: 20 }, (_, i) => {
    const barHeight = phase === 'listening'
      ? Math.max(8, (volume + Math.sin(Date.now() / 200 + i) * 20) * (0.5 + Math.random() * 0.5))
      : 8;
    return barHeight;
  });

  if (phase === 'complete') {
    const avgScore = sessionLog.length > 0
      ? Math.round(sessionLog.reduce((a, b) => a + (b.score || 0), 0) / sessionLog.length * 10)
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
          <p className="vi-complete-subtitle">Average Score</p>

          <div className="vi-session-log">
            <h3>Session Summary</h3>
            {sessionLog.map((entry, i) => (
              <div key={i} className="vi-log-entry">
                <div className="vi-log-q">Q{i + 1}: {entry.question}</div>
                <div className="vi-log-score">Score: {entry.score}/10</div>
                <div className="vi-log-fb">{entry.feedback}</div>
              </div>
            ))}
          </div>

          <button className="vi-btn-primary" onClick={handleRestart}>Start New Interview</button>
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
          disabled={phase === 'speaking' || phase === 'listening' || phase === 'processing'}
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
              <span>Transcribing...</span>
            </div>
          ) : (
            <button
              className="vi-mic-btn vi-mic-start"
              onClick={startRecording}
              disabled={phase === 'speaking' || phase === 'feedback'}
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
            <div className={`vi-score-badge ${
              feedback.score >= 8 ? 'vi-score-high' :
              feedback.score >= 5 ? 'vi-score-mid' : 'vi-score-low'
            }`}>
              {feedback.score}/10
            </div>
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
