import { registerWebhookRuntime } from '../src/pluginRuntime';

type MessageHandler = (message: unknown) => Promise<unknown>;

function createJoplin(noteResponse: unknown = { body: '# Note body' }) {
  let handler: MessageHandler | undefined;
  const register = jest.fn().mockResolvedValue(undefined);
  const onMessage = jest.fn().mockImplementation(async (_id: string, nextHandler: MessageHandler) => {
    handler = nextHandler;
  });
  const get = jest.fn().mockResolvedValue(noteResponse);

  return {
    api: {
      contentScripts: { register, onMessage },
      data: { get },
    },
    register,
    onMessage,
    get,
    handler: () => handler,
  };
}

function successfulResponse(body = 'accepted') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: jest.fn().mockResolvedValue(body),
  };
}

const invalidRequest = {
  kind: 'error',
  message: 'Invalid webhook request.',
  presentation: { printResponse: false, successConfetti: false },
};

const safeWebhookError = {
  kind: 'error',
  message: 'The webhook request could not be completed.',
  presentation: { printResponse: false, successConfetti: false },
};

describe('registerWebhookRuntime', () => {
  test('registers the runtime from the plugin startup entrypoint', async () => {
    const pluginRegister = jest.fn();
    const registerWebhookRuntime = jest.fn().mockResolvedValue(undefined);
    const fetch = jest.fn();
    const originalFetch = global.fetch;

    global.fetch = fetch;
    try {
      jest.isolateModules(() => {
        jest.doMock('api', () => ({
          __esModule: true,
          default: { plugins: { register: pluginRegister } },
        }), { virtual: true });
        jest.doMock('api/types', () => ({
          ContentScriptType: { MarkdownItPlugin: 'markdown-it-plugin' },
        }), { virtual: true });
        jest.doMock('../src/pluginRuntime', () => ({ registerWebhookRuntime }));

        require('../src/index');
      });

      const onStart = pluginRegister.mock.calls[0][0].onStart;
      await onStart();

      expect(registerWebhookRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ plugins: expect.any(Object) }),
        'markdown-it-plugin',
        expect.any(Function),
      );
      const runtimeFetch = registerWebhookRuntime.mock.calls[0][2];
      await runtimeFetch('https://example.test/hook', { method: 'POST', headers: {} });
      expect(fetch).toHaveBeenCalledWith('https://example.test/hook', { method: 'POST', headers: {} });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('registers the renderer content script before making its message handler available', async () => {
    const joplin = createJoplin();
    const calls: string[] = [];
    joplin.register.mockImplementation(async () => { calls.push('register'); });
    joplin.onMessage.mockImplementation(async (_id: string, handler: MessageHandler) => {
      calls.push('onMessage');
      await Promise.resolve();
      (joplin as unknown as { capturedHandler: MessageHandler }).capturedHandler = handler;
    });

    await registerWebhookRuntime(joplin.api, 'markdown-it-plugin', jest.fn());

    expect(joplin.register).toHaveBeenCalledTimes(1);
    expect(joplin.register).toHaveBeenCalledWith('markdown-it-plugin', 'webhook-button', './contentScript/index.js');
    expect(joplin.onMessage).toHaveBeenCalledTimes(1);
    expect(joplin.onMessage).toHaveBeenCalledWith('webhook-button', expect.any(Function));
    expect(calls).toEqual(['register', 'onMessage']);
    expect((joplin as unknown as { capturedHandler?: MessageHandler }).capturedHandler).toEqual(expect.any(Function));
  });

  test('gets a note body and sends it for a valid note request', async () => {
    const joplin = createJoplin({ body: '# Stored note' });
    const fetch = jest.fn().mockResolvedValue(successfulResponse());

    await registerWebhookRuntime(joplin.api, 'markdown-it-plugin', fetch);
    const result = await joplin.handler()!({
      type: 'sendWebhook',
      source: 'url=https://example.test/note\ndata=@abc123',
    });

    expect(joplin.get).toHaveBeenCalledWith(['notes', 'abc123'], { fields: ['body'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://example.test/note', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '# Stored note',
    });
    expect(result).toEqual({
      kind: 'response',
      ok: true,
      status: 200,
      statusText: 'OK',
      body: 'accepted',
      presentation: { printResponse: false, successConfetti: false },
    });
  });

  test('sends a literal payload without reading Joplin data', async () => {
    const joplin = createJoplin();
    const fetch = jest.fn().mockResolvedValue(successfulResponse());

    await registerWebhookRuntime(joplin.api, 'markdown-it-plugin', fetch);
    await joplin.handler()!({
      type: 'sendWebhook',
      source: 'url=https://example.test/literal\ndata=hello webhook',
    });

    expect(joplin.get).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://example.test/literal', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: 'hello webhook',
    });
  });

  test.each([
    null,
    [],
    {},
    { type: 'other', source: 'url=https://example.test/hook' },
    { type: 'sendWebhook', source: 42 },
  ])('rejects malformed messages without accessing dependencies: %p', async (message) => {
    const joplin = createJoplin();
    const fetch = jest.fn();

    await registerWebhookRuntime(joplin.api, 'markdown-it-plugin', fetch);

    await expect(joplin.handler()!(message)).resolves.toEqual(invalidRequest);
    expect(joplin.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    null,
    {},
    { body: null },
    { body: 42 },
  ])('does not leak invalid note responses: %p', async (noteResponse) => {
    const joplin = createJoplin(noteResponse);
    const fetch = jest.fn();

    await registerWebhookRuntime(joplin.api, 'markdown-it-plugin', fetch);

    await expect(joplin.handler()!({
      type: 'sendWebhook',
      source: 'url=https://example.test/hook\ndata=@private-note-id',
    })).resolves.toEqual(safeWebhookError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('does not expose a Joplin note lookup error', async () => {
    const joplin = createJoplin();
    const fetch = jest.fn();
    joplin.get.mockRejectedValue(new Error('private note abc123 is inaccessible'));

    await registerWebhookRuntime(joplin.api, 'markdown-it-plugin', fetch);

    await expect(joplin.handler()!({
      type: 'sendWebhook',
      source: 'url=https://example.test/hook\ndata=@abc123',
    })).resolves.toEqual(safeWebhookError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
