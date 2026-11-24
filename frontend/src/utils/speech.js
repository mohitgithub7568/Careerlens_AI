export function cancelSpeech() {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

const pickEnglishVoice = () => {
  const voices = window.speechSynthesis.getVoices?.() || [];
  return (
    voices.find((v) => /^en[-_]US/i.test(v.lang) && v.localService) ||
    voices.find((v) => /^en[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null
  );
};

/**
 * Speak text with the browser's built-in voice.
 * Returns false when speech synthesis isn't available.
 * `onEnd` fires when speaking finishes, fails, or is cancelled.
 */
export function speakText(text, { onEnd } = {}) {
  const done = () => {
    if (onEnd) onEnd();
  };
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    done();
    return false;
  }

  const cleaned = String(text ?? '').replace(/[*#`]/g, '').trim();
  if (!cleaned) {
    done();
    return false;
  }

  try {
    cancelSpeech();

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    const voice = pickEnglishVoice();
    if (voice) utterance.voice = voice;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    // Chrome can silently drop an utterance queued right after cancel().
    setTimeout(() => {
      window.speechSynthesis.resume?.();
      window.speechSynthesis.speak(utterance);
    }, 50);

    // Safety net: some browsers never fire onend.
    const maxMs = Math.max(5000, cleaned.length * 120);
    setTimeout(finish, maxMs);
    return true;
  } catch {
    done();
    return false;
  }
}

// Voices load asynchronously in Chrome; warm the list early.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    window.speechSynthesis.getVoices();
  } catch {
    // ignore
  }
}
