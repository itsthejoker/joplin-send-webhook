/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const { attachWebhookControls } = require('../src/contentScript/webview');
const initialMatchMedia = window.matchMedia;

function encoded(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function createControl(source, label, contentScriptId = 'webhook-content-script') {
  document.body.innerHTML = '<div class="webhook-control" data-webhook-settings="' + encoded(source) + '" data-webhook-content-script-id="' + contentScriptId + '">'
    + '<button class="webhook-button" type="button">' + label + '</button>'
    + '<div class="webhook-status" role="status"></div>'
    + '</div>';
  return document.querySelector('.webhook-control');
}

function response(overrides) {
  return Object.assign({
    kind: 'response',
    ok: true,
    status: 204,
    statusText: 'No Content',
    body: '',
    presentation: { printResponse: false, successConfetti: false },
  }, overrides);
}

describe('webhook webview controls', () => {
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    if (initialMatchMedia === undefined) delete window.matchMedia;
    else window.matchMedia = initialMatchMedia;
  });

  test('sends decoded Unicode settings once while pending, then restores the original label after a successful 204', async () => {
    const source = 'url=https://example.test/hook\nbutton_text=Café ☕';
    const control = createControl(source, 'Café ☕');
    let resolveRequest;
    const bridge = { postMessage: jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; })) };
    attachWebhookControls(document, bridge);

    const button = control.querySelector('.webhook-button');
    button.click();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Sending…');
    expect(bridge.postMessage).toHaveBeenCalledTimes(1);
    expect(bridge.postMessage).toHaveBeenCalledWith(
      'webhook-content-script',
      { type: 'sendWebhook', source },
    );

    resolveRequest(response());
    await Promise.resolve();

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Café ☕');
    expect(control.querySelector('.webhook-status').textContent).toBe('Sent successfully.');
  });

  test('renders a failed response body as text rather than HTML when printing is enabled', async () => {
    const control = createControl('url=https://example.test/hook', 'Send');
    const bridge = { postMessage: jest.fn(() => Promise.resolve(response({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      body: '<img src=x onerror=alert(1)>',
      presentation: { printResponse: true, successConfetti: false },
    }))) };
    attachWebhookControls(document, bridge);

    control.querySelector('.webhook-button').click();
    await Promise.resolve();

    const status = control.querySelector('.webhook-status');
    const output = control.querySelector('.webhook-response');
    expect(status.textContent).toBe('Request failed: 422 Unprocessable Entity');
    expect(status.classList.contains('webhook-error')).toBe(true);
    expect(output.textContent).toBe('422 Unprocessable Entity\n<img src=x onerror=alert(1)>');
    expect(output.querySelector('img')).toBeNull();
  });

  test('removes an existing response when printing is disabled', async () => {
    const control = createControl('url=https://example.test/hook', 'Send');
    const stale = document.createElement('pre');
    stale.className = 'webhook-response';
    stale.textContent = 'old private result';
    control.appendChild(stale);
    const bridge = { postMessage: jest.fn(() => Promise.resolve(response())) };
    attachWebhookControls(document, bridge);

    control.querySelector('.webhook-button').click();
    await Promise.resolve();

    expect(control.querySelector('.webhook-response')).toBeNull();
  });

  test.each([
    ['bridge throw', () => { throw new Error('private bridge exception'); }, 'url=https://example.test/hook'],
    ['malformed result', () => Promise.resolve({ private: 'private malformed result' }), 'url=https://example.test/hook'],
    ['source decode failure', jest.fn(), '%%%private encoded source%%%'],
  ])('renders only the generic error for %s', async (_caseName, postMessage, source) => {
    document.body.innerHTML = '<div class="webhook-control" data-webhook-settings="' + source + '" data-webhook-content-script-id="webhook-content-script">'
      + '<button class="webhook-button" type="button">Send</button><div class="webhook-status"></div></div>';
    const control = document.querySelector('.webhook-control');
    const bridge = { postMessage: jest.fn(postMessage) };
    attachWebhookControls(document, bridge);

    control.querySelector('.webhook-button').click();
    await Promise.resolve();

    const status = control.querySelector('.webhook-status');
    expect(status.textContent).toBe('The webhook request could not be completed.');
    expect(status.classList.contains('webhook-error')).toBe(true);
    expect(document.body.textContent).not.toContain('private');
    if (_caseName === 'source decode failure') expect(bridge.postMessage).not.toHaveBeenCalled();
  });

  test('ignores disabled controls and never installs duplicate handlers', async () => {
    const control = createControl('url=https://example.test/hook', 'Send');
    const button = control.querySelector('.webhook-button');
    const bridge = { postMessage: jest.fn(() => Promise.resolve(response())) };
    attachWebhookControls(document, bridge);
    attachWebhookControls(document, bridge);
    button.disabled = true;
    button.click();
    expect(bridge.postMessage).not.toHaveBeenCalled();

    button.disabled = false;
    button.click();
    await Promise.resolve();
    expect(bridge.postMessage).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing', null],
    ['blank', '  '],
  ])('rejects a %s content script ID without calling the bridge', async (_caseName, contentScriptId) => {
    const control = createControl('url=https://example.test/hook', 'Send');
    if (contentScriptId === null) control.removeAttribute('data-webhook-content-script-id');
    else control.setAttribute('data-webhook-content-script-id', contentScriptId);
    const bridge = { postMessage: jest.fn(() => Promise.resolve(response())) };
    attachWebhookControls(document, bridge);

    control.querySelector('.webhook-button').click();
    await Promise.resolve();

    expect(bridge.postMessage).not.toHaveBeenCalled();
    expect(control.querySelector('.webhook-status').textContent)
      .toBe('The webhook request could not be completed.');
  });

  test('creates exactly 18 confetti pieces only for opted-in successful responses and cleans them up', async () => {
    jest.useFakeTimers();
    const control = createControl('url=https://example.test/hook', 'Send');
    const bridge = { postMessage: jest.fn(() => Promise.resolve(response({
      presentation: { printResponse: false, successConfetti: true },
    }))) };
    attachWebhookControls(document, bridge);

    control.querySelector('.webhook-button').click();
    await Promise.resolve();
    const layer = control.querySelector('.webhook-confetti');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelectorAll('i')).toHaveLength(18);

    jest.advanceTimersByTime(1400);
    expect(control.querySelector('.webhook-confetti')).toBeNull();
  });

  test.each([
    ['failed response', response({ ok: false, presentation: { printResponse: false, successConfetti: true } }), undefined],
    ['opt-out flag', response({ presentation: { printResponse: false, successConfetti: false } }), undefined],
    ['reduced motion', response({ presentation: { printResponse: false, successConfetti: true } }), true],
  ])('does not create confetti for %s', async (_caseName, result, reducedMotion) => {
    if (reducedMotion) window.matchMedia = jest.fn(() => ({ matches: true }));
    const control = createControl('url=https://example.test/hook', 'Send');
    const bridge = { postMessage: jest.fn(() => Promise.resolve(result)) };
    attachWebhookControls(document, bridge);

    control.querySelector('.webhook-button').click();
    await Promise.resolve();

    expect(control.querySelector('.webhook-confetti')).toBeNull();
  });

  test('styles the control through scoped rules including a reduced-motion fallback', () => {
    const css = fs.readFileSync(path.join(__dirname, '../src/contentScript/webhook.css'), 'utf8');
    expect(css).toContain('.webhook-control');
    expect(css).toContain('.webhook-control .webhook-button');
    expect(css).toContain('.webhook-control .webhook-status.webhook-success');
    expect(css).toContain('.webhook-control .webhook-response');
    expect(css).toContain('.webhook-control .webhook-confetti');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
