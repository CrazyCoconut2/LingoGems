import {
  readAllElements,
  readMetadataCatalog,
  type ElementCatalog,
  type StoredElement,
} from 'collection';

const KIND = 'lingogem-data';
const VERSION = 1;

export const DATA_FILE_NAME = 'lingogem.json.gz';

export type DataFile = {
  kind: typeof KIND;
  version: typeof VERSION;
  elements: StoredElement[];
  catalog: ElementCatalog;
};

export async function buildDataFile(): Promise<Blob> {
  const [elements, catalog] = await Promise.all([readAllElements(), readMetadataCatalog()]);
  const json = JSON.stringify({ kind: KIND, version: VERSION, elements, catalog });
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
  if (!isDataFile(parsed)) throw new Error('Unrecognized data file');
  return parsed;
}

function isDataFile(value: unknown): value is DataFile {
  if (!value || typeof value !== 'object') return false;
  const source = value as {
    kind?: unknown;
    version?: unknown;
    elements?: unknown;
    catalog?: unknown;
  };
  return (
    source.kind === KIND &&
    source.version === VERSION &&
    Array.isArray(source.elements) &&
    !!source.catalog &&
    typeof source.catalog === 'object' &&
    !Array.isArray(source.catalog)
  );
}
