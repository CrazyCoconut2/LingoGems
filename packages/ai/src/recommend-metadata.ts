import { completeJson, runWithKeyFallback } from './complete';
import { AI_ERROR, aiError, attachAiPrompt } from './errors';
import { normalizeMetadataFields, type AiMetadataField } from './metadata-fields';
import { readStoredAiCredentials } from './storage';
import type { CompleteJsonInput } from './types';

const MAX_RECOMMENDED_FIELDS = 6;
const RECOMMEND_MAX_TOKENS = 1024;

const RECOMMEND_SYSTEM_PROMPT = `You recommend metadata fields for a learner's dictionary.
JSON keys stay in English.
Rules:
- kind is definition, example, or form
- Recommend fields that help a learner tell senses or examples apart
- Do not repeat a key already listed in existing. Compare keys without regard to case
- Return at most ${MAX_RECOMMENDED_FIELDS} fields
- key is a short English label
- prompt is the instruction used when that field is filled in later. Leave prompt empty when any fitting value is acceptable. When a small set of values is useful, name that set in the prompt
- Do not recommend a field that only restates the gloss or the example sentence
Return JSON only with this shape:
{"fields":[{"key":"<label>","prompt":"<instruction or empty>"}]}`;

function buildRecommendMetadataUserMessage(
  kind: 'definition' | 'example' | 'form',
  existing: readonly AiMetadataField[],
): string {
  return JSON.stringify({
    kind,
    existing: normalizeMetadataFields(existing).map((field) => ({
      key: field.key,
      ...(field.prompt ? { prompt: field.prompt } : {}),
    })),
  });
}

/** New fields, or null when the reply has no fields array. */
function parseRecommendedMetadataFields(
  parsed: unknown,
  existing: readonly AiMetadataField[],
): AiMetadataField[] | null {
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const list = source ? source['fields'] : null;
  if (!Array.isArray(list)) return null;
  const taken = new Set(normalizeMetadataFields(existing).map((field) => field.key.toLowerCase()));
  const fields: AiMetadataField[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as { key?: unknown; prompt?: unknown };
    fields.push({
      key: typeof record.key === 'string' ? record.key : '',
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
    });
  }
  return normalizeMetadataFields(fields)
    .filter((field) => {
      const id = field.key.toLowerCase();
      if (taken.has(id)) return false;
      taken.add(id);
      return true;
    })
    .slice(0, MAX_RECOMMENDED_FIELDS);
}

/** Ask the saved model for metadata fields the learner does not already keep. */
export async function recommendMetadataFields(
  kind: 'definition' | 'example' | 'form',
  existing: readonly AiMetadataField[],
): Promise<AiMetadataField[]> {
  const input: CompleteJsonInput = {
    system: RECOMMEND_SYSTEM_PROMPT,
    user: buildRecommendMetadataUserMessage(kind, existing),
    maxTokens: RECOMMEND_MAX_TOKENS,
    temperature: 0.4,
  };
  const keys = readStoredAiCredentials().keys;
  const complete = () =>
    runWithKeyFallback(keys, (provider, credentials) => completeJson(provider, input, credentials));
  try {
    let fields = parseRecommendedMetadataFields(await complete(), existing);
    if (!fields) fields = parseRecommendedMetadataFields(await complete(), existing);
    if (!fields) aiError(AI_ERROR.RESPONSE_INVALID);
    return fields;
  } catch (err) {
    throw attachAiPrompt(err, input);
  }
}
