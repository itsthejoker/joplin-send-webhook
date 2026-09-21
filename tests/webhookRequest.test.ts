import { sendWebhook } from '../src/webhookRequest';

describe('sendWebhook', () => {
  test('sends JSON with inferred content type and returns the response', async () => {
    const getNoteBody = jest.fn();
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn().mockResolvedValue('accepted'),
    });

    await expect(sendWebhook([
      'url=https://example.com/hook',
      'data={"message":"hello"}',
      'headers={"x-auth":"token"}',
      'print_response=true',
    ].join('\n'), { getNoteBody, fetch })).resolves.toEqual({
      kind: 'response',
      ok: true,
      status: 200,
      statusText: 'OK',
      body: 'accepted',
      presentation: { printResponse: true, successConfetti: false },
    });

    expect(fetch).toHaveBeenCalledWith('https://example.com/hook', {
      method: 'POST',
      headers: { 'x-auth': 'token', 'Content-Type': 'application/json' },
      body: '{"message":"hello"}',
    });
  });

  test('resolves note payloads and preserves a configured content type', async () => {
    const getNoteBody = jest.fn().mockResolvedValue('# Note\n\nMarkdown');
    const fetch = jest.fn().mockResolvedValue(response());

    await sendWebhook([
      'url=https://example.com/hook',
      'data=@note-123',
      'headers={"content-type":"text/markdown"}',
    ].join('\n'), { getNoteBody, fetch });

    expect(getNoteBody).toHaveBeenCalledWith('note-123');
    expect(fetch).toHaveBeenCalledWith('https://example.com/hook', {
      method: 'POST',
      headers: { 'content-type': 'text/markdown' },
      body: '# Note\n\nMarkdown',
    });
  });

  test('sends plain text with an inferred content type', async () => {
    const fetch = jest.fn().mockResolvedValue(response());

    await sendWebhook('url=https://example.com/hook\ndata=hello world', {
      getNoteBody: jest.fn(),
      fetch,
    });

    expect(fetch).toHaveBeenCalledWith('https://example.com/hook', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: 'hello world',
    });
  });

  test('sends omitted data without a body or inferred content type', async () => {
    const fetch = jest.fn().mockResolvedValue(response());

    await sendWebhook('url=https://example.com/hook', { getNoteBody: jest.fn(), fetch });

    expect(fetch).toHaveBeenCalledWith('https://example.com/hook', {
      method: 'POST',
      headers: {},
      body: undefined,
    });
  });

  test('returns non-2xx responses without converting them to errors', async () => {
    const fetch = jest.fn().mockResolvedValue(response({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Content',
      body: 'invalid input',
    }));

    await expect(sendWebhook('url=https://example.com/hook', { getNoteBody: jest.fn(), fetch })).resolves.toEqual({
      kind: 'response',
      ok: false,
      status: 422,
      statusText: 'Unprocessable Content',
      body: 'invalid input',
      presentation: { printResponse: false, successConfetti: false },
    });
  });

  test('does not expose private request details when fetch fails', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('network secret: should not leak'));

    await expect(sendWebhook([
      'url=https://example.com/hook',
      'data=private body',
      'headers={"Authorization":"Bearer private-token"}',
    ].join('\n'), { getNoteBody: jest.fn(), fetch })).resolves.toEqual(safeError());
  });

  test('returns the safe error when getting a note body fails', async () => {
    await expect(sendWebhook('url=https://example.com/hook\ndata=@secret-note', {
      getNoteBody: jest.fn().mockRejectedValue(new Error('secret note failure')),
      fetch: jest.fn(),
    })).resolves.toEqual(safeError());
  });

  test('returns the safe error when reading the response body fails', async () => {
    await expect(sendWebhook('url=https://example.com/hook', {
      getNoteBody: jest.fn(),
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn().mockRejectedValue(new Error('secret response failure')),
      }),
    })).resolves.toEqual(safeError());
  });

  test('rejects invalid settings without calling dependencies', async () => {
    const getNoteBody = jest.fn();
    const fetch = jest.fn();

    await expect(sendWebhook('url=file:///private/path', { getNoteBody, fetch })).resolves.toEqual({
      kind: 'error',
      message: 'url must use http or https.',
      presentation: { printResponse: false, successConfetti: false },
    });

    expect(getNoteBody).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('propagates presentation flags for responses and transport errors', async () => {
    const source = [
      'url=https://example.com/hook',
      'print_response=true',
      'success_confetti=true',
    ].join('\n');
    const presentation = { printResponse: true, successConfetti: true };

    await expect(sendWebhook(source, {
      getNoteBody: jest.fn(),
      fetch: jest.fn().mockResolvedValue(response()),
    })).resolves.toEqual(expect.objectContaining({ kind: 'response', presentation }));
    await expect(sendWebhook(source, {
      getNoteBody: jest.fn(),
      fetch: jest.fn().mockRejectedValue(new Error('transport failure')),
    })).resolves.toEqual({
      kind: 'error',
      message: 'The webhook request could not be completed.',
      presentation,
    });
  });
});

function response(overrides: Partial<{ ok: boolean; status: number; statusText: string; body: string }> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    ...overrides,
    text: jest.fn().mockResolvedValue(overrides.body === undefined ? 'response body' : overrides.body),
  };
}

function safeError() {
  return {
    kind: 'error',
    message: 'The webhook request could not be completed.',
    presentation: { printResponse: false, successConfetti: false },
  };
}
