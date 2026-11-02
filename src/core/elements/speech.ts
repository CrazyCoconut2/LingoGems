/** Short app codes → BCP-47 tags browser voice lists actually use. */
const SPEECH_BCP47: Record<string, string> = {
  ar: 'ar-XA',
  cmn: 'zh-CN',
  cs: 'cs-CZ',
  da: 'da-DK',
  de: 'de-DE',
  el: 'el-GR',
  en: 'en-US',
  es: 'es-ES',
  fi: 'fi-FI',
  fr: 'fr-FR',
  he: 'he-IL',
  hi: 'hi-IN',
  id: 'id-ID',
  it: 'it-IT',
  iw: 'he-IL',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ms: 'ms-MY',
  nb: 'nb-NO',
  nl: 'nl-NL',
  nn: 'nn-NO',
  no: 'nb-NO',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  sv: 'sv-SE',
  th: 'th-TH',
  tr: 'tr-TR',
  vi: 'vi-VN',
  yue: 'zh-HK',
  zh: 'zh-CN',
};

const MAX_CHUNK_CHARS = 240;

let speakSeq = 0;

export function canSpeak(): boolean {
  return !!speechHost().speechSynthesis && !!speechHost().SpeechSynthesisUtterance;
}

export function stopSpeaking(): void {
  speakSeq += 1;
  try {
    speechHost().speechSynthesis?.cancel();
  } catch {
    // Ignore a missing or restricted speech engine.
  }
}

/** Speak one passage in the element's language. Cancels anything already speaking. */
export function speakText(text: string, lang: string, onEnd: () => void): boolean {
  const host = speechHost();
  const synth = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  const chunks = splitLongChunk(text.replace(/\s+/g, ' ').trim());
  const code = speechLang(lang);
  if (!synth || !Utterance || !chunks.length || !code) return false;

  stopSpeaking();
  const seq = speakSeq;
  setTimeout(() => {
    if (seq !== speakSeq) return;
    whenVoicesReady(synth, seq, () => {
      if (seq !== speakSeq) return;
      const voice = pickVoice(synth.getVoices(), code);
      let remaining = chunks.length;
      const finish = (): void => {
        if (seq !== speakSeq) return;
        remaining -= 1;
        if (remaining <= 0) onEnd();
      };
      for (const chunk of chunks) {
        const utterance = new Utterance(chunk);
        utterance.lang = voice?.lang?.trim() || code;
        if (voice) utterance.voice = voice;
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      }
    });
  }, 20);
  return true;
}

function whenVoicesReady(synth: SpeechSynthesis, seq: number, ready: () => void): void {
  if (synth.getVoices().length) {
    ready();
    return;
  }
  let settled = false;
  const finish = (): void => {
    if (settled || seq !== speakSeq) return;
    settled = true;
    synth.removeEventListener?.('voiceschanged', finish);
    ready();
  };
  synth.addEventListener?.('voiceschanged', finish);
  setTimeout(finish, 400);
}

function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  const prefix = lang.split('-')[0] ?? lang;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const code = voice.lang.trim().toLowerCase().replace(/_/g, '-');
    let score = 0;
    if (code === lang) score = 2;
    else if (code.split('-')[0] === prefix) score = 1;
    if (!score) continue;
    if (voice.localService) score += 2;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

function speechLang(lang: string): string {
  const raw = lang.trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return '';
  if (raw.includes('-')) return raw;
  return SPEECH_BCP47[raw] ?? raw;
}

function splitLongChunk(text: string): string[] {
  if (!text) return [];
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const word of words) {
    if (!buf) {
      buf = word;
      continue;
    }
    if (buf.length + 1 + word.length <= MAX_CHUNK_CHARS) buf += ` ${word}`;
    else {
      out.push(buf);
      buf = word;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function speechHost(): {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
} {
  return globalThis;
}
