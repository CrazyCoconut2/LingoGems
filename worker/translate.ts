import { languageDisplayName } from '../packages/collection/src/languages/catalog';

const TRANSLATE_SYSTEM_PROMPT = `You translate each input string into targetLang.
JSON keys stay in English.
texts is an array of strings. Return exactly one translation per item, same order and count. Do not merge, split, reorder, drop, or invent items. Do not add commentary, quotes, or extra markup.
When sourceLang is present, treat it as the source language; otherwise detect it.
Keep meaning literal and faithful. Preserve punctuation and line breaks inside each string.
Spelling in targetLang MUST be correct. No orthographic errors, no invented spellings.
JSON only: {"translations":["<text 0>","<text 1>",...]}`;

const AI_DEFAULT_MODELS = {
  openai: 'gpt-5',
  anthropic: 'claude-opus-4-5',
  google: 'gemini-3.6-pro',
  groq: 'openai/gpt-oss-120b',
} as const;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TEXTS = 20;
const MAX_TEXT_CHARS = 2_000;
const MAX_TOTAL_CHARS = 8_000;
const TRANSLATE_MAX_TOKENS = 4096;

type AiProvider = keyof typeof AI_DEFAULT_MODELS;

type TranslateInput = {
  texts: string[];
  targetLang: string;
  sourceLang: string | null;
};

type TranslateRow = { text: string };

class RelayError extends Error {
  constructor(readonly status: number) {
    super('translate_failed');
  }
}

export async function handleTranslate(request: Request): Promise<Response> {
  try {
    const body = readRecord(await request.json());
    const texts = readTexts(body['texts']);
    const targetLang = String(body['targetLang'] ?? '').trim();
    const sourceLang = String(body['sourceLang'] ?? '').trim() || null;
    if (!targetLang) throw new RelayError(400);
    const input: TranslateInput = { texts, targetLang, sourceLang };
    const rows = await translateWithModel(readAi(body['ai']), input);
    if (rows.length !== texts.length || rows.some((row) => !row.text.trim())) {
      throw new RelayError(502);
    }
    return Response.json({ translations: rows.map((row) => ({ text: row.text })) });
  } catch (error) {
    const status = error instanceof RelayError ? error.status : 502;
    return Response.json({ error: 'translate_failed' }, { status });
  }
}

function readTexts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new RelayError(400);
  const texts = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  const total = texts.reduce((sum, item) => sum + item.length, 0);
  if (
    texts.length === 0 ||
    texts.length > MAX_TEXTS ||
    texts.some((item) => item.length > MAX_TEXT_CHARS) ||
    total > MAX_TOTAL_CHARS
  ) {
    throw new RelayError(400);
  }
  return texts;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function secret(record: Record<string, unknown>, key: string): string {
  return String(record[key] ?? '').trim();
}

function isAiProvider(value: string): value is AiProvider {
  return value === 'openai' || value === 'anthropic' || value === 'google' || value === 'groq';
}

function readAi(value: unknown): { provider: AiProvider; apiKey: string; model: string } {
  const record = readRecord(value);
  const provider = String(record['provider'] ?? '').trim();
  const apiKey = secret(record, 'apiKey');
  if (!isAiProvider(provider) || !apiKey) throw new RelayError(400);
  return { provider, apiKey, model: secret(record, 'model') };
}

async function translateWithModel(
  ai: { provider: AiProvider; apiKey: string; model: string },
  input: TranslateInput,
): Promise<TranslateRow[]> {
  const targetName = languageDisplayName(input.targetLang) || input.targetLang;
  const sourceName = input.sourceLang
    ? languageDisplayName(input.sourceLang) || input.sourceLang
    : '';
  const user = JSON.stringify({
    texts: input.texts,
    targetLang: targetName,
    ...(sourceName ? { sourceLang: sourceName } : {}),
  });
  let translations = readGenerated(await completeText(ai, user), input.texts.length);
  if (!translations) {
    translations = readGenerated(await completeText(ai, user), input.texts.length);
  }
  if (!translations) throw new RelayError(502);
  return translations.map((text) => ({ text }));
}

function readGenerated(content: string, expected: number): string[] | null {
  const parsed = extractJson(content);
  const list = readRecord(parsed)['translations'];
  if (!Array.isArray(list) || list.length !== expected) return null;
  const translations = list.map((item) => String(item ?? '').trim());
  if (translations.some((item) => !item)) return null;
  return translations;
}

async function completeText(
  ai: { provider: AiProvider; apiKey: string; model: string },
  user: string,
): Promise<string> {
  const model = ai.model || AI_DEFAULT_MODELS[ai.provider];
  switch (ai.provider) {
    case 'openai':
      return chatCompletions(OPENAI_URL, ai.apiKey, model, user);
    case 'groq':
      return chatCompletions(GROQ_URL, ai.apiKey, model, user);
    case 'anthropic':
      return anthropicMessage(ai.apiKey, model, user);
    case 'google':
      return googleMessage(ai.apiKey, model, user);
  }
}

async function chatCompletions(
  url: string,
  apiKey: string,
  model: string,
  user: string,
): Promise<string> {
  const data = readRecord(
    await postJson(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: TRANSLATE_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      }),
    }),
  );
  const choices = Array.isArray(data['choices']) ? data['choices'] : [];
  const message = readRecord(readRecord(choices[0])['message']);
  return typeof message['content'] === 'string' ? message['content'] : '';
}

async function anthropicMessage(apiKey: string, model: string, user: string): Promise<string> {
  const data = readRecord(
    await postJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: TRANSLATE_MAX_TOKENS,
        temperature: 0,
        system: TRANSLATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      }),
    }),
  );
  const content = Array.isArray(data['content']) ? data['content'] : [];
  return content
    .map((part) => {
      const record = readRecord(part);
      return record['type'] === 'text' ? String(record['text'] ?? '') : '';
    })
    .join('');
}

async function googleMessage(apiKey: string, model: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const data = readRecord(
    await postJson(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: TRANSLATE_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: TRANSLATE_MAX_TOKENS,
          responseMimeType: 'application/json',
        },
      }),
    }),
  );
  const candidates = Array.isArray(data['candidates']) ? data['candidates'] : [];
  const content = readRecord(readRecord(candidates[0])['content']);
  const parts = Array.isArray(content['parts']) ? content['parts'] : [];
  return parts
    .map((part) => {
      const record = readRecord(part);
      if (record['thought']) return '';
      return String(record['text'] ?? '');
    })
    .join('');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? trimmed).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function postJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new RelayError(502);
  }
  if (!response.ok) {
    throw new RelayError(response.status === 401 || response.status === 403 ? 401 : 502);
  }
  try {
    return await response.json();
  } catch {
    throw new RelayError(502);
  }
}
