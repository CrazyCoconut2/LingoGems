import {
  normalizeStoredPhraseTranslations,
  readAllElements,
  readAllPhraseTranslations,
  readMetadataCatalog,
  type ElementCatalog,
  type StoredElement,
  type StoredPhraseTranslation,
} from 'collection';

const KIND = 'lingogem-data';
const VERSION = 2;

export const DATA_FILE_NAME = 'lingogem.json.gz';

export type DataFile = {
  kind: typeof KIND;
  version: typeof VERSION;
  elements: StoredElement[];
  catalog: ElementCatalog;
  translations: StoredPhraseTranslation[];
};

export async function buildDataFile(): Promise<Blob> {
  const [elements, catalog, translations] = await Promise.all([
    readAllElements(),
    readMetadataCatalog(),
    readAllPhraseTranslations(),
  ]);
  const json = JSON.stringify({ kind: KIND, version: VERSION, elements, catalog, translations });
  const stream = new Blob([new TextEncoder().encode(json)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export function downloadDataFile(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = DATA_FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readDataFile(file: Blob): Promise<DataFile> {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  const parsed: unknown = JSON.parse(await new Response(stream).text());
  const data = dataFileOf(parsed);
  if (!data) throw new Error('Unrecognized data file');
  return data;
}

function dataFileOf(value: unknown): DataFile | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as {
    kind?: unknown;
    version?: unknown;
    elements?: unknown;
    catalog?: unknown;
    translations?: unknown;
  };
  if (
    source.kind !== KIND ||
    source.version !== VERSION ||
    !Array.isArray(source.elements) ||
    !Array.isArray(source.translations) ||
    !source.catalog ||
    typeof source.catalog !== 'object' ||
    Array.isArray(source.catalog)
  ) {
    return null;
  }
  return {
    kind: KIND,
    version: VERSION,
    elements: source.elements as StoredElement[],
    catalog: source.catalog as ElementCatalog,
    translations: normalizeStoredPhraseTranslations(source.translations),
  };
}
