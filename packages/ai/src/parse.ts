import { AI_ERROR, aiError } from './errors';

/** Parse the first JSON object or array in a model reply (fenced or raw). */
function extractJson(text: unknown): unknown {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : trimmed).trim();
  const objStart = raw.indexOf('{');
  const arrStart = raw.indexOf('[');
  const startCandidates = [objStart, arrStart].filter((index) => index >= 0);
  if (!startCandidates.length) {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
  const start = Math.min(...startCandidates);
  const close = raw[start] === '[' ? ']' : '}';
  const end = raw.lastIndexOf(close);
  if (end <= start) {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
}

export function extractJsonObject(text: unknown): Record<string, unknown> {
  const value = extractJson(text);
  if (Array.isArray(value)) {
    // Models often omit the {"words":[...]} envelope for recommendations.
    return { words: value };
  }
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  aiError(AI_ERROR.RESPONSE_INVALID);
}
