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
type TranslationProvider = 'deepl' | 'google' | 'azure' | 'amazon';

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
    const provider = String(body['provider'] ?? '').trim();
    const rows = isTranslationProvider(provider)
      ? await translateWithProvider(provider, input, readRecord(body['secrets']))
      : await translateWithModel(readAi(body['ai']), input);
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

function isTranslationProvider(value: string): value is TranslationProvider {
  return value === 'deepl' || value === 'google' || value === 'azure' || value === 'amazon';
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

function providerLang(value: string): string {
  const parts = value.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].toUpperCase();
  return `${parts[0].toUpperCase()}-${parts[1].toUpperCase()}`;
}

function bcp47(value: string): string {
  const parts = value.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].toLowerCase();
  return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
}

async function translateWithProvider(
  provider: TranslationProvider,
  input: TranslateInput,
  secrets: Record<string, unknown>,
): Promise<TranslateRow[]> {
  switch (provider) {
    case 'deepl':
      return translateWithDeepL(input, secret(secrets, 'apiKey'));
    case 'google':
      return translateWithGoogle(input, secret(secrets, 'apiKey'));
    case 'azure':
      return translateWithAzure(
        input,
        secret(secrets, 'subscriptionKey'),
        secret(secrets, 'region'),
      );
    case 'amazon':
      return translateWithAmazon(
        input,
        secret(secrets, 'accessKeyId'),
        secret(secrets, 'secretAccessKey'),
        secret(secrets, 'region'),
      );
  }
}

async function translateWithDeepL(input: TranslateInput, apiKey: string): Promise<TranslateRow[]> {
  if (!apiKey) throw new RelayError(400);
  const target = providerLang(input.targetLang);
  const source = input.sourceLang ? providerLang(input.sourceLang) : '';
  if (!target) throw new RelayError(400);
  const base = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const data = readRecord(
    await postJson(`${base}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: input.texts,
        target_lang: target,
        ...(source ? { source_lang: source } : {}),
      }),
    }),
  );
  const translations = Array.isArray(data['translations']) ? data['translations'] : [];
  return translations.map((item) => ({ text: String(readRecord(item)['text'] ?? '') }));
}

async function translateWithGoogle(input: TranslateInput, apiKey: string): Promise<TranslateRow[]> {
  if (!apiKey) throw new RelayError(400);
  const target = bcp47(input.targetLang);
  const source = input.sourceLang ? bcp47(input.sourceLang) : '';
  if (!target) throw new RelayError(400);
  const url = new URL('https://translation.googleapis.com/language/translate/v2');
  url.searchParams.set('key', apiKey);
  const data = readRecord(
    await postJson(url.toString(), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: input.texts,
        target,
        format: 'text',
        ...(source ? { source } : {}),
      }),
    }),
  );
  const payload = readRecord(data['data']);
  const translations = Array.isArray(payload['translations']) ? payload['translations'] : [];
  return translations.map((item) => ({
    text: String(readRecord(item)['translatedText'] ?? ''),
  }));
}

async function translateWithAzure(
  input: TranslateInput,
  subscriptionKey: string,
  region: string,
): Promise<TranslateRow[]> {
  if (!subscriptionKey || !region) throw new RelayError(400);
  const target = bcp47(input.targetLang);
  const source = input.sourceLang ? bcp47(input.sourceLang) : '';
  if (!target) throw new RelayError(400);
  const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
  url.searchParams.set('api-version', '3.0');
  url.searchParams.set('to', target);
  if (source) url.searchParams.set('from', source);
  const data = await postJson(url.toString(), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Ocp-Apim-Subscription-Region': region,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.texts.map((text) => ({ Text: text }))),
  });
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const translations = readRecord(row)['translations'];
    const first = Array.isArray(translations) ? readRecord(translations[0]) : {};
    return { text: String(first['text'] ?? '') };
  });
}

async function translateWithAmazon(
  input: TranslateInput,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<TranslateRow[]> {
  if (!accessKeyId || !secretAccessKey || !/^[a-z0-9-]{1,32}$/i.test(region)) {
    throw new RelayError(400);
  }
  const target = bcp47(input.targetLang);
  if (!target) throw new RelayError(400);
  const source = input.sourceLang ? bcp47(input.sourceLang) : 'auto';
  const rows: TranslateRow[] = [];
  for (const text of input.texts) {
    const data = await signedAmazonJson(region, accessKeyId, secretAccessKey, {
      Text: text,
      SourceLanguageCode: source,
      TargetLanguageCode: target,
    });
    rows.push({ text: String(data['TranslatedText'] ?? '') });
  }
  return rows;
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

async function signedAmazonJson(
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const host = `translate.${region}.amazonaws.com`;
  const payload = JSON.stringify(body);
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = now.slice(0, 8);
  const contentType = 'application/x-amz-json-1.1';
  const target = 'AWSShineFrontendService_20170701.TranslateText';
  const payloadHash = await sha256Hex(payload);
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-date:${now}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );
  const credentialScope = `${dateStamp}/${region}/translate/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    now,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const key = await signingKey(secretAccessKey, dateStamp, region, 'translate');
  const signature = bufferToHex(await hmac(key, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return readRecord(
    await postJson(`https://${host}/`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Accept: 'application/json',
        'X-Amz-Date': now,
        'X-Amz-Target': target,
        Authorization: authorization,
      },
      body: payload,
    }),
  );
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return bufferToHex(hash);
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
