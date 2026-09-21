import { parseWebhookSettings } from './webhookConfig';

export interface WebhookDependencies {
  getNoteBody(noteId: string): Promise<string>;
  fetch(url: string, init: {
    method: 'POST';
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;
}

type Presentation = { printResponse: boolean; successConfetti: boolean };

export type WebhookResult =
  | { kind: 'response'; ok: boolean; status: number; statusText: string; body: string; presentation: Presentation }
  | { kind: 'error'; message: string; presentation: Presentation };

const SAFE_ERROR_MESSAGE = 'The webhook request could not be completed.';

export async function sendWebhook(source: string, deps: WebhookDependencies): Promise<WebhookResult> {
  const parsed = parseWebhookSettings(source);
  if (parsed.ok === false) {
    return {
      kind: 'error',
      message: parsed.errors.join('\n'),
      presentation: { printResponse: false, successConfetti: false },
    };
  }

  const config = parsed.config;
  const presentation = {
    printResponse: config.printResponse,
    successConfetti: config.successConfetti,
  };
  const headers = { ...config.headers };
  let body: string | undefined;
  let inferredContentType: string | undefined;

  try {
    if (config.payload.kind === 'note') {
      body = await deps.getNoteBody(config.payload.noteId);
      inferredContentType = 'text/plain;charset=UTF-8';
    } else if (config.payload.kind === 'json') {
      body = JSON.stringify(config.payload.value);
      inferredContentType = 'application/json';
    } else if (config.payload.kind === 'text') {
      body = config.payload.value;
      inferredContentType = 'text/plain;charset=UTF-8';
    }

    if (inferredContentType && !hasContentTypeHeader(headers)) {
      headers['Content-Type'] = inferredContentType;
    }

    const response = await deps.fetch(config.url, { method: 'POST', headers, body });
    const responseBody = await response.text();
    return {
      kind: 'response',
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: responseBody,
      presentation,
    };
  } catch (_) {
    return { kind: 'error', message: SAFE_ERROR_MESSAGE, presentation };
  }
}

function hasContentTypeHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
}
