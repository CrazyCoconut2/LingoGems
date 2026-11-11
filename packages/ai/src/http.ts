import { AI_ERROR, AiError, aiError } from './errors';

function mapProviderHttpError(status: number, bodyText = ''): never {
  const text = String(bodyText || '').toLowerCase();
  let err: AiError;
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 &&
      /api[_ ]key not valid|invalid api key|permission denied|unauthenticated|api_key_invalid/.test(
        text,
      ))
  ) {
    err = new AiError(AI_ERROR.PROVIDER_AUTH_FAILED, 401, status);
  } else if (status === 429) {
    err = new AiError(AI_ERROR.QUOTA_EXCEEDED, 429, status);
  } else if (status === 400 || status === 404) {
    err = new AiError(AI_ERROR.FAILED, 400, status);
  } else {
    err = new AiError(AI_ERROR.UNAVAILABLE, 400, status);
  }
  throw err;
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text.slice(0, 500);
}

/** Call a provider from the browser. Never attach Linguagem cookies. */
export async function fetchProviderJson(
  url: string,
  options: RequestInit,
  logLabel: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'omit',
    });
  } catch (err) {
    console.error(`[${logLabel}]`, err instanceof Error ? err.message : err);
    aiError(AI_ERROR.UNAVAILABLE);
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    console.error(`[${logLabel}]`, res.status, body);
    mapProviderHttpError(res.status, body);
  }
  try {
    return await res.json();
  } catch {
    aiError(AI_ERROR.RESPONSE_INVALID);
  }
}
