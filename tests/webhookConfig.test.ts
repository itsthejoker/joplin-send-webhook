import { parseWebhookSettings } from '../src/webhookConfig';

describe('parseWebhookSettings', () => {
  test('parses a complete valid settings block', () => {
    const result = parseWebhookSettings([
      '# A comment',
      'url = https://example.com/hook?token=a=b',
      'data = {"message":"hello"}',
      'headers = {"X-Signature":"a=b"}',
      'success_confetti = true',
      'print_response = true',
      'button_text = Deliver',
      'background_color = #aabbcc',
    ].join('\n'));

    expect(result).toEqual({
      ok: true,
      config: {
        url: 'https://example.com/hook?token=a=b',
        payload: { kind: 'json', value: { message: 'hello' } },
        headers: { 'X-Signature': 'a=b' },
        successConfetti: true,
        printResponse: true,
        buttonText: 'Deliver',
        backgroundColor: '#aabbcc',
      },
    });
  });

  test('uses defaults for omitted optional settings', () => {
    expect(parseWebhookSettings('url=https://example.com/hook')).toEqual({
      ok: true,
      config: {
        url: 'https://example.com/hook',
        payload: { kind: 'empty' },
        headers: {},
        successConfetti: false,
        printResponse: false,
        buttonText: 'Send Webhook',
      },
    });
  });

  test('parses plain-text and note payloads', () => {
    const textResult = parseWebhookSettings('url=https://example.com\ndata=hello world');
    const noteResult = parseWebhookSettings('url=https://example.com\ndata=@note-123');

    expect(textResult).toEqual(expect.objectContaining({
      ok: true,
      config: expect.objectContaining({ payload: { kind: 'text', value: 'hello world' } }),
    }));
    expect(noteResult).toEqual(expect.objectContaining({
      ok: true,
      config: expect.objectContaining({ payload: { kind: 'note', noteId: 'note-123' } }),
    }));
  });

  test('rejects missing, invalid, and non-http URLs', () => {
    const missing = parseWebhookSettings('button_text=Send');
    const invalid = parseWebhookSettings('url=not a url');
    const file = parseWebhookSettings('url=file:///tmp/data');

    expect(missing).toEqual({ ok: false, errors: expect.arrayContaining(['url is required.']) });
    expect(invalid).toEqual({ ok: false, errors: expect.arrayContaining(['url must be a valid absolute URL.']) });
    expect(file).toEqual({ ok: false, errors: expect.arrayContaining(['url must use http or https.']) });
  });

  test('reports malformed, unknown, duplicate, and independent errors together', () => {
    const result = parseWebhookSettings([
      'not-a-setting',
      'unknown=value',
      'url=https://example.com',
      'url=https://duplicate.example.com',
      'print_response=yes',
      'button_text=',
    ].join('\n'));

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        'Line 1 must be a key=value pair.',
        'Unknown setting: unknown.',
        'Duplicate setting: url.',
        'print_response must be true or false.',
        'button_text must not be empty.',
      ]),
    });
  });

  test('rejects invalid booleans, an empty note ID, and an empty explicit button text', () => {
    const result = parseWebhookSettings([
      'url=https://example.com',
      'success_confetti=TRUE',
      'print_response=1',
      'data=@',
      'button_text=',
    ].join('\n'));

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        'success_confetti must be true or false.',
        'print_response must be true or false.',
        'data note ID must not be empty.',
        'button_text must not be empty.',
      ]),
    });
  });

  test('validates headers as a JSON object with string values', () => {
    const invalidHeaders = [
      '[]',
      '{"X-Retries":3}',
      'null',
      '{bad json}',
    ];

    invalidHeaders.forEach((headers) => {
      expect(parseWebhookSettings('url=https://example.com\nheaders=' + headers)).toEqual({
        ok: false,
        errors: expect.arrayContaining(['headers must be a JSON object with string values.']),
      });
    });

    expect(parseWebhookSettings('url=https://example.com\nheaders={"Accept":"application/json"}')).toEqual(
      expect.objectContaining({
        ok: true,
        config: expect.objectContaining({ headers: { Accept: 'application/json' } }),
      }),
    );
  });

  test('accepts supported background colors and rejects injection-like values', () => {
    [
      'red',
      '#abc',
      '#abcd',
      '#aabbccdd',
      'rgb(10, 20, 30)',
      'rgba(10%, 20%, 30%, 50%)',
      'hsl(120, 50%, 50%)',
      'hsla(120, 50%, 50%, 0.5)',
    ].forEach((color) => {
      expect(parseWebhookSettings('url=https://example.com\nbackground_color=' + color)).toEqual(
        expect.objectContaining({
          ok: true,
          config: expect.objectContaining({ backgroundColor: color }),
        }),
      );
    });

    expect(parseWebhookSettings('url=https://example.com\nbackground_color=url(evil)')).toEqual({
      ok: false,
      errors: expect.arrayContaining(['background_color is not a supported color.']),
    });
  });
});
