import { sendWebhook, WebhookDependencies, WebhookResult } from './webhookRequest';

type WebhookMessage = { type: 'sendWebhook'; source: string };
type MessageHandler = (message: unknown) => Promise<WebhookResult>;

export interface JoplinWebhookApi {
  contentScripts: {
    register(type: unknown, id: string, scriptPath: string): Promise<void>;
    onMessage(contentScriptId: string, handler: MessageHandler): Promise<void>;
  };
  data: {
    get(path: string[], query: { fields: string[] }): Promise<unknown>;
  };
}

const INVALID_REQUEST: WebhookResult = {
  kind: 'error',
  message: 'Invalid webhook request.',
  presentation: { printResponse: false, successConfetti: false },
};

export async function registerWebhookRuntime(
  joplinApi: JoplinWebhookApi,
  markdownItPluginType: unknown,
  fetchImpl: WebhookDependencies['fetch'],
): Promise<void> {
  await joplinApi.contentScripts.register(markdownItPluginType, 'webhook-button', './contentScript/index.js');

  await joplinApi.contentScripts.onMessage('webhook-button', async (message) => {
    if (!isWebhookMessage(message)) return INVALID_REQUEST;

    return sendWebhook(message.source, {
      fetch: fetchImpl,
      getNoteBody: async (noteId) => {
        const note = await joplinApi.data.get(['notes', noteId], { fields: ['body'] });
        if (!isObjectWithStringBody(note)) throw new Error('Note body is unavailable.');
        return note.body;
      },
    });
  });
}

function isWebhookMessage(value: unknown): value is WebhookMessage {
  return isPlainObject(value) && value.type === 'sendWebhook' && typeof value.source === 'string';
}

function isObjectWithStringBody(value: unknown): value is { body: string } {
  return isPlainObject(value) && typeof value.body === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
