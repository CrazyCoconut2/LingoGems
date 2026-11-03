const GENERATE_TRANSLATIONS_KEY = 'lingogem.ai-generate-translations.v1';

type GenerateTranslations = {
  definitions: boolean;
  examples: boolean;
};

/** English when this language should come back with a translation. */
export function translationLanguage(language: string, enabled: boolean): string {
  const code = language.trim().toLowerCase();
  if (!enabled || !code || code === 'en') return '';
  return 'English';
}

export function readGenerateDefinitionTranslations(): boolean {
  return readStored().definitions;
}

export function readGenerateExampleTranslations(): boolean {
  return readStored().examples;
}

export function writeGenerateDefinitionTranslations(enabled: boolean): void {
  const current = readStored();
  persist({ ...current, definitions: enabled });
}

export function writeGenerateExampleTranslations(enabled: boolean): void {
  const current = readStored();
  persist({ ...current, examples: enabled });
}

function readStored(): GenerateTranslations {
  if (typeof localStorage === 'undefined') return { definitions: true, examples: true };
  try {
    const raw = localStorage.getItem(GENERATE_TRANSLATIONS_KEY);
    if (!raw) return { definitions: true, examples: true };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { definitions: true, examples: true };
    }
    const record = parsed as { definitions?: unknown; examples?: unknown };
    return {
      definitions: record.definitions !== false,
      examples: record.examples !== false,
    };
  } catch {
    return { definitions: true, examples: true };
  }
}

function persist(state: GenerateTranslations): void {
  if (typeof localStorage === 'undefined') return;
  const stored: { definitions?: false; examples?: false } = {};
  if (!state.definitions) stored.definitions = false;
  if (!state.examples) stored.examples = false;
  if (!Object.keys(stored).length) localStorage.removeItem(GENERATE_TRANSLATIONS_KEY);
  else localStorage.setItem(GENERATE_TRANSLATIONS_KEY, JSON.stringify(stored));
}
