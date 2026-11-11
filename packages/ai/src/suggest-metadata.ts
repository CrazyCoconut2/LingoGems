import { languageDisplayName, type ElementMetadata } from 'collection';
import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { MAX_METADATA_FIELD_KEY } from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

const MAX_SUGGESTED_FIELDS = 4;
const SUGGEST_MAX_TOKENS = 1024;
const MAX_VALUE_LENGTH = 100;

const SUGGEST_SYSTEM_PROMPT = `You add metadata for one dictionary entry.
JSON keys stay in English. Each metadata value is written in writeFieldsIn.
Rules:
- kind is definition, example, or form
- text is that definition, example, or form
- Add only fields that are relevant to this text
- Do not repeat a key already listed in existing. Compare keys without regard to case
- Do not restate the text itself
- Each key is a short English name
- Each value is short, specific to this text, and written in writeFieldsIn
- Return at most ${MAX_SUGGESTED_FIELDS} pairs
- Omit a field when it does not apply
Return JSON only with this shape:
{"metadata":{"<key>":"<value>"}}`;

type SuggestMetadataKind = 'definition' | 'example' | 'form';

type SuggestMetadataInput = {
  kind: SuggestMetadataKind;
  lemma: string;
  language: string;
  text: string;
  existing: ElementMetadata;
};

function buildSuggestMetadataUserMessage(input: SuggestMetadataInput): string {
  const language = input.language.trim().toLowerCase();
  return JSON.stringify({
    kind: input.kind,
    lemma: input.lemma.trim(),
    writeFieldsIn: languageDisplayName(language) || language,
    text: input.text.trim(),
    existing: input.existing,
  });
}

/** New pairs, or null when the reply has no metadata object. */
function parseSuggestedMetadata(
  parsed: unknown,
  existing: ElementMetadata,
): ElementMetadata | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const raw = source ? source['metadata'] : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const taken = new Set(Object.keys(existing).map((key) => key.toLowerCase()));
  const metadata: ElementMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (typeof rawValue !== 'string') continue;
    const key = rawKey.replace(/\s+/g, ' ').trim().slice(0, MAX_METADATA_FIELD_KEY);
    const value = capitalizeValue(rawValue);
    if (!key || !value) continue;
    const id = key.toLowerCase();
    if (taken.has(id)) continue;
    taken.add(id);
    metadata[key] = value;
    if (Object.keys(metadata).length >= MAX_SUGGESTED_FIELDS) break;
  }
  return metadata;
}

/** Ask for metadata this text does not already have. */
export async function suggestMetadata(input: SuggestMetadataInput): Promise<ElementMetadata> {
  const text = input.text.trim();
  if (!text) return {};
  const request: CompleteJsonInput = {
    system: SUGGEST_SYSTEM_PROMPT,
    user: buildSuggestMetadataUserMessage({ ...input, text }),
    maxTokens: SUGGEST_MAX_TOKENS,
    temperature: 0.4,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, request, credentials));
  try {
    let metadata = parseSuggestedMetadata(await complete(), input.existing);
    if (!metadata) metadata = parseSuggestedMetadata(await complete(), input.existing);
    if (!metadata) aiError(AI_ERROR.RESPONSE_INVALID);
    return metadata;
  } catch (err) {
    throw attachAiPrompt(err, request);
  }
}

function capitalizeValue(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_LENGTH);
  return text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('en'));
}
