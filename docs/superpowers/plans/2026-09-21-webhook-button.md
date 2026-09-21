# Webhook Button Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Joplin Markdown plugin that turns `webhook-settings` fences into buttons that POST inline or note-referenced content to user-configured endpoints.

**Architecture:** A Markdown-It content script validates settings and renders a safe, editable control. Its browser asset sends the original settings to the main plugin, which validates again, resolves note references, performs the POST, and returns a serializable result for inline display.

**Tech Stack:** TypeScript 4.8, Joplin Plugin API 3.7, Markdown-It, browser JavaScript/CSS, Jest 29, ts-jest 29, and jsdom.

---

## File structure

- `src/webhookConfig.ts`: Configuration types, parsing, defaults, and validation.
- `src/webhookRequest.ts`: Note resolution, request construction, and safe response results.
- `src/contentScript/index.ts`: Markdown-It fence rendering and HTML escaping.
- `src/contentScript/webview.js`: Button state, bridge calls, feedback, and confetti.
- `src/contentScript/webhook.css`: Scoped control and animation styling.
- `src/pluginRuntime.ts`: Joplin registration and message routing with injectable dependencies.
- `src/index.ts`: Minimal Joplin entry point.
- `tests/*.test.*`: Unit, renderer, DOM, and registration tests.
- `jest.config.js`, `package.json`, `package-lock.json`: Test harness.
- `plugin.config.json`: External content-script build entry.
- `README.md`, `src/manifest.json`: User documentation and metadata.

### Task 1: Configure automated tests

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `jest.config.js`

- [ ] **Step 1: Install pinned test dependencies**

Run:

```bash
npm install --save-dev jest@29.7.0 ts-jest@29.2.5 @types/jest@29.5.14 jest-environment-jsdom@29.7.0
```

Expected: exit 0 and all four packages appear in the package files.

- [ ] **Step 2: Add test scripts to `package.json`**

Add these keys to the existing `scripts` object:

```json
"test": "jest --runInBand",
"test:watch": "jest --watch"
```

- [ ] **Step 3: Create `jest.config.js`**

```javascript
module.exports = {
  clearMocks: true,
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.js'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  testEnvironmentOptions: { url: 'https://joplin.local/' },
};
```

- [ ] **Step 4: Verify and commit the harness**

Run: `npm test -- --passWithNoTests`

Expected: exit 0 with `No tests found`.

```bash
git add package.json package-lock.json jest.config.js
git commit -m "test: add Jest harness"
```

### Task 2: Parse and validate webhook settings

**Files:**
- Create: `src/webhookConfig.ts`
- Create: `tests/webhookConfig.test.ts`

- [ ] **Step 1: Write the first failing parser tests**

Create `tests/webhookConfig.test.ts`:

```typescript
import { parseWebhookSettings } from '../src/webhookConfig';

test('parses settings and splits at the first equals sign', () => {
  expect(parseWebhookSettings([
    '# comment',
    'url=https://example.com/hook?token=a=b',
    'data={"hello":"world"}',
    'headers={"x-auth":"a=b"}',
    'success_confetti=true',
    'print_response=true',
    'button_text=Publish Blog',
    'background_color=#b2e5e9',
  ].join('\n'))).toEqual({
    ok: true,
    config: {
      url: 'https://example.com/hook?token=a=b',
      payload: { kind: 'json', value: { hello: 'world' } },
      headers: { 'x-auth': 'a=b' },
      successConfetti: true,
      printResponse: true,
      buttonText: 'Publish Blog',
      backgroundColor: '#b2e5e9',
    },
  });
});

test('applies defaults and recognizes text and note payloads', () => {
  expect(parseWebhookSettings('url=https://example.com')).toMatchObject({
    ok: true,
    config: {
      payload: { kind: 'empty' }, headers: {}, successConfetti: false,
      printResponse: false, buttonText: 'Send Webhook',
    },
  });
  expect(parseWebhookSettings('url=https://example.com\ndata=hello')).toMatchObject({
    ok: true, config: { payload: { kind: 'text', value: 'hello' } },
  });
  expect(parseWebhookSettings('url=https://example.com\ndata=@abc123')).toMatchObject({
    ok: true, config: { payload: { kind: 'note', noteId: 'abc123' } },
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/webhookConfig.test.ts`

Expected: FAIL because `src/webhookConfig.ts` does not exist.

- [ ] **Step 3: Implement the parser API**

Create `src/webhookConfig.ts`:

```typescript
export type WebhookPayload =
  | { kind: 'empty' }
  | { kind: 'note'; noteId: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string };

export interface WebhookConfig {
  url: string;
  payload: WebhookPayload;
  headers: Record<string, string>;
  successConfetti: boolean;
  printResponse: boolean;
  buttonText: string;
  backgroundColor?: string;
}

export type ParseResult =
  | { ok: true; config: WebhookConfig }
  | { ok: false; errors: string[] };

const keys = new Set([
  'url', 'data', 'headers', 'success_confetti', 'print_response',
  'button_text', 'background_color',
]);

function payload(value?: string): WebhookPayload {
  if (value === undefined) return { kind: 'empty' };
  if (value.startsWith('@')) return { kind: 'note', noteId: value.slice(1) };
  try { return { kind: 'json', value: JSON.parse(value) }; }
  catch { return { kind: 'text', value }; }
}

export function parseWebhookSettings(source: string): ParseResult {
  const values = new Map<string, string>();
  const errors: string[] = [];
  source.split(/\r?\n/).forEach((original, index) => {
    const line = original.trim();
    if (!line || line.startsWith('#')) return;
    const equals = line.indexOf('=');
    if (equals < 1) return void errors.push(`Line ${index + 1} must be a key=value pair.`);
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (!keys.has(key)) errors.push(`Unknown setting: ${key}.`);
    else if (values.has(key)) errors.push(`Duplicate setting: ${key}.`);
    else values.set(key, value);
  });

  const booleanValue = (key: string): boolean => {
    const value = values.get(key);
    if (value === undefined) return false;
    if (value !== 'true' && value !== 'false') {
      errors.push(`${key} must be true or false.`);
      return false;
    }
    return value === 'true';
  };

  let headers: Record<string, string> = {};
  if (values.has('headers')) {
    try { headers = JSON.parse(values.get('headers')!); }
    catch { errors.push('headers must be a JSON object with string values.'); }
  }
  const config: WebhookConfig = {
    url: values.get('url') || '',
    payload: payload(values.get('data')),
    headers,
    successConfetti: booleanValue('success_confetti'),
    printResponse: booleanValue('print_response'),
    buttonText: values.get('button_text') || 'Send Webhook',
    ...(values.has('background_color')
      ? { backgroundColor: values.get('background_color') }
      : {}),
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/webhookConfig.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Add failing validation tests**

Append:

```typescript
test.each([
  ['button_text=Send', 'url is required'],
  ['url=file:///tmp/hook', 'url must use http or https'],
  ['url=https://example.com\nbroken', 'Line 2'],
  ['url=https://example.com\ntimeout=10', 'Unknown setting: timeout'],
  ['url=https://one.example\nurl=https://two.example', 'Duplicate setting: url'],
  ['url=https://example.com\nprint_response=yes', 'print_response must be true or false'],
  ['url=https://example.com\ndata=@', 'note ID'],
  ['url=https://example.com\nbutton_text=', 'button_text must not be empty'],
  ['url=https://example.com\nbackground_color=url(evil)', 'background_color'],
])('rejects invalid source', (source, message) => {
  const result = parseWebhookSettings(source);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join(' ')).toContain(message);
});

test.each(['headers=[]', 'headers={"x":1}', 'headers=null', 'headers={bad}'])
('rejects invalid headers', headers => {
  expect(parseWebhookSettings(`url=https://example.com\n${headers}`)).toMatchObject({ ok: false });
});

test.each(['red', '#abc', '#aabbccdd', 'rgb(10, 20, 30)', 'hsl(120, 50%, 50%)'])
('accepts supported color %s', color => {
  expect(parseWebhookSettings(`url=https://example.com\nbackground_color=${color}`))
    .toMatchObject({ ok: true, config: { backgroundColor: color } });
});
```

- [ ] **Step 6: Run validation tests and verify RED**

Run: `npm test -- tests/webhookConfig.test.ts`

Expected: validation cases FAIL.

- [ ] **Step 7: Add validation and re-run GREEN**

Add these helpers above `parseWebhookSettings`:

```typescript
function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).every(key => typeof (value as Record<string, unknown>)[key] === 'string');
}

function isSupportedColor(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    || /^[a-z]+$/i.test(value)
    || /^rgba?\([\d.%\s,]+\)$/i.test(value)
    || /^hsla?\([\d.%\s,+-]+\)$/i.test(value);
}

function validateUrl(value: string, errors: string[]): void {
  if (!value) return void errors.push('url is required.');
  try {
    const protocol = new URL(value).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      errors.push('url must use http or https.');
    }
  } catch { errors.push('url must be a valid absolute URL.'); }
}
```

Replace the original `headers` and `config` block with:

```typescript
  let headers: Record<string, string> = {};
  if (values.has('headers')) {
    try {
      const parsedHeaders: unknown = JSON.parse(values.get('headers')!);
      if (isStringRecord(parsedHeaders)) headers = parsedHeaders;
      else errors.push('headers must be a JSON object with string values.');
    } catch { errors.push('headers must be a JSON object with string values.'); }
  }

  const url = values.get('url') || '';
  validateUrl(url, errors);
  const parsedPayload = payload(values.get('data'));
  if (parsedPayload.kind === 'note' && !parsedPayload.noteId) {
    errors.push('data note reference must include a note ID.');
  }
  const suppliedButtonText = values.get('button_text');
  if (suppliedButtonText !== undefined && !suppliedButtonText) {
    errors.push('button_text must not be empty.');
  }
  const backgroundColor = values.get('background_color');
  if (backgroundColor !== undefined && !isSupportedColor(backgroundColor)) {
    errors.push('background_color is not a supported color.');
  }

  const config: WebhookConfig = {
    url,
    payload: parsedPayload,
    headers,
    successConfetti: booleanValue('success_confetti'),
    printResponse: booleanValue('print_response'),
    buttonText: suppliedButtonText || 'Send Webhook',
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
  };
```

Run: `npm test -- tests/webhookConfig.test.ts`

Expected: all parser tests pass.

- [ ] **Step 8: Commit the parser**

```bash
git add src/webhookConfig.ts tests/webhookConfig.test.ts
git commit -m "feat: parse webhook settings"
```

### Task 3: Resolve payloads and send requests

**Files:**
- Create: `src/webhookRequest.ts`
- Create: `tests/webhookRequest.test.ts`

- [ ] **Step 1: Write failing request tests**

Create `tests/webhookRequest.test.ts`:

```typescript
import { sendWebhook, WebhookDependencies } from '../src/webhookRequest';

const dependencies = (overrides: Partial<WebhookDependencies> = {}): WebhookDependencies => ({
  getNoteBody: jest.fn(async () => '# Referenced note'),
  fetch: jest.fn(async () => ({
    ok: true, status: 200, statusText: 'OK', text: async () => 'created',
  })),
  ...overrides,
});

test('sends JSON with inferred content type', async () => {
  const deps = dependencies();
  const result = await sendWebhook([
    'url=https://example.com/hook', 'data={"hello":"world"}',
    'headers={"x-auth":"secret"}', 'print_response=true',
  ].join('\n'), deps);
  expect(deps.fetch).toHaveBeenCalledWith('https://example.com/hook', {
    method: 'POST',
    headers: { 'x-auth': 'secret', 'Content-Type': 'application/json' },
    body: '{"hello":"world"}',
  });
  expect(result).toMatchObject({
    kind: 'response', ok: true, status: 200, body: 'created',
    presentation: { printResponse: true, successConfetti: false },
  });
});

test('resolves note Markdown and preserves configured content type', async () => {
  const deps = dependencies();
  await sendWebhook([
    'url=https://example.com/hook', 'data=@abc123',
    'headers={"content-type":"text/markdown"}',
  ].join('\n'), deps);
  expect(deps.getNoteBody).toHaveBeenCalledWith('abc123');
  expect(deps.fetch).toHaveBeenCalledWith('https://example.com/hook', {
    method: 'POST', headers: { 'content-type': 'text/markdown' }, body: '# Referenced note',
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/webhookRequest.test.ts`

Expected: FAIL because `src/webhookRequest.ts` does not exist.

- [ ] **Step 3: Implement request execution**

Create `src/webhookRequest.ts`:

```typescript
import { parseWebhookSettings, WebhookConfig } from './webhookConfig';

export interface WebhookDependencies {
  getNoteBody(noteId: string): Promise<string>;
  fetch(url: string, init: {
    method: 'POST'; headers: Record<string, string>; body?: string;
  }): Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;
}

type Presentation = { printResponse: boolean; successConfetti: boolean };
export type WebhookResult =
  | { kind: 'response'; ok: boolean; status: number; statusText: string; body: string; presentation: Presentation }
  | { kind: 'error'; message: string; presentation: Presentation };

const presentation = (config?: WebhookConfig): Presentation => ({
  printResponse: config?.printResponse ?? false,
  successConfetti: config?.successConfetti ?? false,
});

export async function sendWebhook(source: string, deps: WebhookDependencies): Promise<WebhookResult> {
  const parsed = parseWebhookSettings(source);
  if (!parsed.ok) {
    return { kind: 'error', message: parsed.errors.join(' '), presentation: presentation() };
  }
  const { config } = parsed;
  const headers = { ...config.headers };
  let body: string | undefined;
  let inferredType: string | undefined;
  try {
    if (config.payload.kind === 'note') {
      body = await deps.getNoteBody(config.payload.noteId);
      inferredType = 'text/plain;charset=UTF-8';
    } else if (config.payload.kind === 'json') {
      body = JSON.stringify(config.payload.value);
      inferredType = 'application/json';
    } else if (config.payload.kind === 'text') {
      body = config.payload.value;
      inferredType = 'text/plain;charset=UTF-8';
    }
    const hasType = Object.keys(headers).some(key => key.toLowerCase() === 'content-type');
    if (inferredType && !hasType) headers['Content-Type'] = inferredType;
    const response = await deps.fetch(config.url, { method: 'POST', headers, body });
    return {
      kind: 'response', ok: response.ok, status: response.status,
      statusText: response.statusText, body: await response.text(),
      presentation: presentation(config),
    };
  } catch {
    return {
      kind: 'error', message: 'The webhook request could not be completed.',
      presentation: presentation(config),
    };
  }
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/webhookRequest.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Add edge-case tests**

Append these tests:

```typescript
test('sends an empty body without an inferred content type', async () => {
  const deps = dependencies();
  await sendWebhook('url=https://example.com', deps);
  expect(deps.fetch).toHaveBeenCalledWith('https://example.com', {
    method: 'POST', headers: {}, body: undefined,
  });
});

test('returns non-2xx HTTP responses without converting them to transport errors', async () => {
  const deps = dependencies({ fetch: jest.fn(async () => ({
    ok: false, status: 422, statusText: 'Invalid', text: async () => 'bad input',
  })) });
  await expect(sendWebhook('url=https://example.com', deps)).resolves.toMatchObject({
    kind: 'response', ok: false, status: 422, body: 'bad input',
  });
});

test('returns a safe transport error', async () => {
expect(await sendWebhook('url=https://example.com\ndata=private', dependencies({
  fetch: jest.fn(async () => { throw new Error('secret detail'); }),
}))).toEqual({
  kind: 'error',
  message: 'The webhook request could not be completed.',
  presentation: { printResponse: false, successConfetti: false },
});
});

test('rejects invalid source before privileged operations run', async () => {
  const deps = dependencies();
  expect(await sendWebhook('url=file:///tmp/private', deps)).toMatchObject({ kind: 'error' });
  expect(deps.fetch).not.toHaveBeenCalled();
  expect(deps.getNoteBody).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Verify and commit request behavior**

Run: `npm test -- tests/webhookRequest.test.ts`

Expected: all request tests pass.

```bash
git add src/webhookRequest.ts tests/webhookRequest.test.ts
git commit -m "feat: send validated webhook requests"
```

### Task 4: Render safe Markdown controls

**Files:**
- Create: `src/contentScript/index.ts`
- Create: `tests/contentScript.test.ts`
- Modify: `plugin.config.json`

- [ ] **Step 1: Write failing renderer tests**

Create `tests/contentScript.test.ts`:

```typescript
import createContentScript from '../src/contentScript';

function renderer() {
  const fallback = jest.fn(() => '<pre>fallback</pre>');
  const markdownIt: any = { renderer: { rules: { fence: fallback } } };
  const module = createContentScript({ contentScriptId: 'webhook-button' } as any);
  module.plugin(markdownIt, {});
  const render = (info: string, content: string) =>
    markdownIt.renderer.rules.fence([{ info, content }], 0, {}, {}, {});
  return { fallback, module, render };
}

test('delegates unrelated fences', () => {
  const { fallback, render } = renderer();
  expect(render('json', '{}')).toBe('<pre>fallback</pre>');
  expect(fallback).toHaveBeenCalled();
});

test('renders editable, escaped webhook markup', () => {
  const { render } = renderer();
  const html = render('webhook-settings', [
    'url=https://example.com',
    'button_text=Publish <script>alert(1)</script>',
    'background_color=#b2e5e9',
  ].join('\n'));
  expect(html).toContain('class="joplin-editable webhook-control"');
  expect(html).toContain('class="joplin-source"');
  expect(html).toContain('data-joplin-language="webhook-settings"');
  expect(html).toContain('Publish &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('--webhook-background:#b2e5e9');
});

test('renders invalid settings as a disabled control', () => {
  const html = renderer().render('webhook-settings', 'url=file:///tmp/hook');
  expect(html).toContain('disabled');
  expect(html).toContain('url must use http or https');
});

test('declares the viewer assets', () => {
  expect(renderer().module.assets()).toEqual([
    { name: './contentScript/webview.js' },
    { name: './contentScript/webhook.css' },
  ]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/contentScript.test.ts`

Expected: FAIL because `src/contentScript/index.ts` does not exist.

- [ ] **Step 3: Implement the renderer**

Create `src/contentScript/index.ts`:

```typescript
import { parseWebhookSettings } from '../webhookConfig';

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export default function createContentScript(_context: unknown): any {
  return {
    plugin(markdownIt: any): void {
      const fallback = markdownIt.renderer.rules.fence
        || ((tokens: any[], index: number) => `<pre>${escapeHtml(tokens[index].content)}</pre>`);
      markdownIt.renderer.rules.fence = (
        tokens: any[], index: number, options: unknown, env: unknown, self: unknown,
      ): string => {
        const token = tokens[index];
        if (token.info.trim() !== 'webhook-settings') {
          return fallback(tokens, index, options, env, self);
        }
        const source = token.content.replace(/\n$/, '');
        const parsed = parseWebhookSettings(source);
        const encoded = Buffer.from(source, 'utf8').toString('base64');
        const label = parsed.ok ? parsed.config.buttonText : 'Invalid webhook settings';
        const error = parsed.ok ? '' : parsed.errors.join(' ');
        const style = parsed.ok && parsed.config.backgroundColor
          ? ` style="--webhook-background:${escapeHtml(parsed.config.backgroundColor)}"` : '';
        return [
          `<div class="joplin-editable webhook-control" data-webhook-settings="${encoded}"${style}>`,
          '<pre class="joplin-source" data-joplin-language="webhook-settings" '
            + 'data-joplin-source-open="```webhook-settings&NewLine;" '
            + `data-joplin-source-close="\`\`\`">${escapeHtml(source)}</pre>`,
          `<button class="webhook-button" type="button"${parsed.ok ? '' : ' disabled'}>${escapeHtml(label)}</button>`,
          `<div class="webhook-status" role="status" aria-live="polite">${escapeHtml(error)}</div>`,
          '</div>',
        ].join('');
      };
    },
    assets: () => [
      { name: './contentScript/webview.js' },
      { name: './contentScript/webhook.css' },
    ],
  };
}
```

- [ ] **Step 4: Configure compilation and verify**

Replace `plugin.config.json`:

```json
{ "extraScripts": ["contentScript/index.ts"] }
```

Run: `npm test -- tests/contentScript.test.ts tests/webhookConfig.test.ts`

Expected: both suites pass.

- [ ] **Step 5: Commit the renderer**

```bash
git add src/contentScript/index.ts tests/contentScript.test.ts plugin.config.json
git commit -m "feat: render webhook settings controls"
```

### Task 5: Add browser interactions and styling

**Files:**
- Create: `src/contentScript/webview.js`
- Create: `src/contentScript/webhook.css`
- Create: `tests/webview.test.js`

- [ ] **Step 1: Write failing jsdom tests**

Create `tests/webview.test.js`:

```javascript
/** @jest-environment jsdom */

global.TextDecoder = require('util').TextDecoder;
const { attachWebhookControls } = require('../src/contentScript/webview');

function markup() {
  document.body.innerHTML = `
    <div class="webhook-control" data-webhook-settings="${Buffer.from('url=https://example.com').toString('base64')}">
      <button class="webhook-button">Publish</button>
      <div class="webhook-status"></div>
    </div>`;
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('uses a disabled pending state and restores the label', async () => {
  markup();
  let finish;
  attachWebhookControls(document, {
    postMessage: jest.fn(() => new Promise(resolve => { finish = resolve; })),
  });
  const button = document.querySelector('.webhook-button');
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Sending…');
  finish({
    kind: 'response', ok: true, status: 204, statusText: 'No Content', body: '',
    presentation: { printResponse: false, successConfetti: false },
  });
  await settle();
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('Publish');
  expect(document.querySelector('.webhook-status').textContent).toBe('Sent successfully.');
});

test('prints opted-in response bodies as text', async () => {
  markup();
  attachWebhookControls(document, { postMessage: async () => ({
    kind: 'response', ok: false, status: 422, statusText: 'Invalid',
    body: '<img src=x onerror=alert(1)>',
    presentation: { printResponse: true, successConfetti: false },
  }) });
  document.querySelector('.webhook-button').click();
  await settle();
  expect(document.querySelector('.webhook-response').textContent).toContain('<img');
  expect(document.querySelector('.webhook-response img')).toBeNull();
});

test('shows safe bridge errors', async () => {
  markup();
  attachWebhookControls(document, { postMessage: async () => { throw new Error('private'); } });
  document.querySelector('.webhook-button').click();
  await settle();
  expect(document.querySelector('.webhook-status').textContent)
    .toBe('The webhook request could not be completed.');
});

test('creates confetti only after opted-in success', async () => {
  markup();
  window.matchMedia = jest.fn(() => ({ matches: false }));
  attachWebhookControls(document, { postMessage: async () => ({
    kind: 'response', ok: true, status: 200, statusText: 'OK', body: 'created',
    presentation: { printResponse: false, successConfetti: true },
  }) });
  document.querySelector('.webhook-button').click();
  await settle();
  expect(document.querySelectorAll('.webhook-confetti i')).toHaveLength(18);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/webview.test.js`

Expected: FAIL because `src/contentScript/webview.js` does not exist.

- [ ] **Step 3: Implement DOM behavior**

Create `src/contentScript/webview.js`:

```javascript
(function initialise(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof webviewApi !== 'undefined') {
    api.attachWebhookControls(document, webviewApi);
  }
}(function factory() {
  const decode = encoded => {
    const binary = atob(encoded);
    return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  };
  const confetti = control => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'webhook-confetti';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 18; i += 1) {
      const piece = document.createElement('i');
      piece.style.setProperty('--confetti-index', String(i));
      layer.appendChild(piece);
    }
    control.appendChild(layer);
    setTimeout(() => layer.remove(), 1400);
  };
  const render = (control, result) => {
    const status = control.querySelector('.webhook-status');
    control.querySelector('.webhook-response')?.remove();
    if (result.kind === 'error') {
      status.textContent = result.message;
      status.className = 'webhook-status webhook-error';
      return;
    }
    status.textContent = result.ok
      ? 'Sent successfully.' : `Request failed: ${result.status} ${result.statusText}`.trim();
    status.className = `webhook-status ${result.ok ? 'webhook-success' : 'webhook-error'}`;
    if (result.presentation.printResponse) {
      const response = document.createElement('pre');
      response.className = 'webhook-response';
      response.textContent = `${result.status} ${result.statusText}\n${result.body || '(empty response body)'}`;
      control.appendChild(response);
    }
    if (result.ok && result.presentation.successConfetti) confetti(control);
  };
  const attachWebhookControls = (root, bridge) => {
    root.querySelectorAll('.webhook-control').forEach(control => {
      const button = control.querySelector('.webhook-button');
      if (!button || button.disabled || button.dataset.webhookAttached) return;
      button.dataset.webhookAttached = 'true';
      button.addEventListener('click', async () => {
        const label = button.textContent;
        button.disabled = true;
        button.textContent = 'Sending…';
        try {
          render(control, await bridge.postMessage({
            type: 'sendWebhook', source: decode(control.dataset.webhookSettings),
          }));
        } catch {
          render(control, { kind: 'error', message: 'The webhook request could not be completed.' });
        } finally {
          button.disabled = false;
          button.textContent = label;
        }
      });
    });
  };
  return { attachWebhookControls };
}));
```

- [ ] **Step 4: Run DOM tests and verify GREEN**

Run: `npm test -- tests/webview.test.js`

Expected: all DOM tests pass.

- [ ] **Step 5: Create scoped styles**

Create `src/contentScript/webhook.css`:

```css
.webhook-control { position: relative; display: flex; min-height: 12rem; box-sizing: border-box; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; overflow: hidden; padding: 2rem; border-radius: .75rem; background: var(--webhook-background, transparent); }
.webhook-control .joplin-source { display: none; }
.webhook-button { max-width: 100%; padding: 1rem 2.5rem; border: 0; border-radius: .55rem; background: var(--joplin-color, #1266d4); color: var(--joplin-background-color, #fff); font: inherit; font-size: 1.25rem; font-weight: 600; cursor: pointer; }
.webhook-button:disabled { cursor: wait; opacity: .65; }
.webhook-status { text-align: center; }
.webhook-success { color: #16733c; }
.webhook-error { color: #a12622; }
.webhook-response { width: 100%; max-height: 20rem; box-sizing: border-box; overflow: auto; padding: 1rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.webhook-confetti { position: absolute; inset: 0; pointer-events: none; }
.webhook-confetti i { --angle: calc(var(--confetti-index) * 20deg); position: absolute; top: 50%; left: 50%; width: .45rem; height: .8rem; background: hsl(calc(var(--confetti-index) * 47deg) 80% 55%); animation: webhook-confetti 1.2s ease-out forwards; transform: rotate(var(--angle)) translateY(-1rem); }
@keyframes webhook-confetti { to { transform: rotate(var(--angle)) translateY(-9rem) rotate(240deg); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .webhook-confetti { display: none; } }
```

- [ ] **Step 6: Verify and commit viewer assets**

Run: `npm test -- tests/webview.test.js`

Expected: all DOM tests pass.

```bash
git add src/contentScript/webview.js src/contentScript/webhook.css tests/webview.test.js
git commit -m "feat: add webhook button interactions"
```

### Task 6: Register the Joplin runtime

**Files:**
- Create: `src/pluginRuntime.ts`
- Create: `tests/pluginRuntime.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing registration tests**

Create `tests/pluginRuntime.test.ts`:

```typescript
import { registerWebhookRuntime } from '../src/pluginRuntime';

function fakeJoplin() {
  let handler: (message: unknown) => Promise<unknown>;
  const api = {
    contentScripts: {
      register: jest.fn(async () => undefined),
      onMessage: jest.fn(async (_id: string, callback: typeof handler) => { handler = callback; }),
    },
    data: { get: jest.fn(async () => ({ body: '# Note body' })) },
  };
  return { api, getHandler: () => handler! };
}

test('registers the renderer and routes webhook messages', async () => {
  const { api, getHandler } = fakeJoplin();
  const fetchImpl = jest.fn(async () => ({
    ok: true, status: 200, statusText: 'OK', text: async () => 'created',
  }));
  await registerWebhookRuntime(api as any, 'markdownItPlugin', fetchImpl as any);
  expect(api.contentScripts.register).toHaveBeenCalledWith(
    'markdownItPlugin', 'webhook-button', './contentScript/index.js',
  );
  await expect(getHandler()({
    type: 'sendWebhook', source: 'url=https://example.com\ndata=@abc123',
  })).resolves.toMatchObject({ kind: 'response', ok: true });
  expect(api.data.get).toHaveBeenCalledWith(['notes', 'abc123'], { fields: ['body'] });
});

test('rejects malformed bridge messages', async () => {
  const { api, getHandler } = fakeJoplin();
  await registerWebhookRuntime(api as any, 'markdownItPlugin', jest.fn() as any);
  await expect(getHandler()({ type: 'other' })).resolves.toMatchObject({ kind: 'error' });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/pluginRuntime.test.ts`

Expected: FAIL because `src/pluginRuntime.ts` does not exist.

- [ ] **Step 3: Implement registration and routing**

Create `src/pluginRuntime.ts`:

```typescript
import { sendWebhook, WebhookDependencies } from './webhookRequest';

export async function registerWebhookRuntime(
  joplinApi: any,
  markdownItPluginType: any,
  fetchImpl: WebhookDependencies['fetch'],
): Promise<void> {
  const id = 'webhook-button';
  await joplinApi.contentScripts.register(markdownItPluginType, id, './contentScript/index.js');
  await joplinApi.contentScripts.onMessage(id, async (message: unknown) => {
    if (!message || typeof message !== 'object'
      || (message as any).type !== 'sendWebhook'
      || typeof (message as any).source !== 'string') {
      return {
        kind: 'error', message: 'Invalid webhook request.',
        presentation: { printResponse: false, successConfetti: false },
      };
    }
    return sendWebhook((message as any).source, {
      getNoteBody: async noteId => {
        const note = await joplinApi.data.get(['notes', noteId], { fields: ['body'] });
        if (!note || typeof note.body !== 'string') throw new Error('Note not found');
        return note.body;
      },
      fetch: fetchImpl,
    });
  });
}
```

- [ ] **Step 4: Replace `src/index.ts`**

```typescript
import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerWebhookRuntime } from './pluginRuntime';

joplin.plugins.register({
  onStart: async function() {
    await registerWebhookRuntime(
      joplin,
      ContentScriptType.MarkdownItPlugin,
      (url, init) => fetch(url, init),
    );
  },
});
```

- [ ] **Step 5: Verify and commit runtime wiring**

Run: `npm test -- tests/pluginRuntime.test.ts tests/webhookRequest.test.ts`

Expected: both suites pass.

```bash
git add src/pluginRuntime.ts src/index.ts tests/pluginRuntime.test.ts
git commit -m "feat: register webhook plugin runtime"
```

### Task 7: Document configuration and finish metadata

**Files:**
- Modify: `README.md`
- Modify: `src/manifest.json`

- [ ] **Step 1: Replace generated README content**

Replace `README.md` with:

````markdown
# Webhook Button for Joplin

Turn a `webhook-settings` fenced block into a large button that sends a POST request from Joplin.

## Configuration

```webhook-settings
url=https://example.com/webhook
data={"hello":"world"}
headers={"authorization":"Bearer replace-me","x-source":"joplin"}
success_confetti=true
print_response=true
button_text=Publish Blog
background_color=#b2e5e9
```

`url` is required and must use HTTP or HTTPS. `headers` is a JSON object whose keys and values are strings. Valid JSON `data` is sent as JSON; other inline data is sent as text. The plugin adds a matching `Content-Type` only when you do not supply one.

To send another note's raw Markdown body, use its Joplin note ID:

```text
data=@0123456789abcdef0123456789abcdef
```

Optional settings default to `success_confetti=false`, `print_response=false`, `button_text=Send Webhook`, and the current background. Blank lines and lines beginning with `#` are ignored.

## Security

Clicking the button sends the configured body and headers to the configured endpoint. Inspect controls received from other people before clicking, especially when they reference another note or a local-network service. Responses are displayed as plain text and are not saved.

## Development

```bash
npm test
npm run dist
```

The build creates the installable `.jpl` archive in `publish/`.
````

- [ ] **Step 2: Update manifest discovery metadata**

Change only these values in `src/manifest.json`:

```json
"description": "Turn a page into a button that sends a webhook payload to an endpoint and displays the response.",
"keywords": ["webhook", "automation", "http", "post"],
"categories": ["integrations", "productivity"]
```

- [ ] **Step 3: Build and commit documentation**

Run: `npm run dist`

Expected: exit 0 and `publish/com.joekaufeld.sendwebhook.jpl` exists.

```bash
git add README.md src/manifest.json
git commit -m "docs: explain webhook button configuration"
```

### Task 8: Full verification and requirement audit

**Files:**
- Modify only a source file together with the test that exposes any verification defect.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: all 5 suites pass with zero failed tests.

- [ ] **Step 2: Build the production archive**

Run: `npm run dist`

Expected: exit 0 and `publish/com.joekaufeld.sendwebhook.jpl` exists.

- [ ] **Step 3: Inspect packaged assets**

Run: `tar -tf publish/com.joekaufeld.sendwebhook.jpl | sort`

Expected entries include `index.js`, `manifest.json`, `contentScript/index.js`, `contentScript/webview.js`, and `contentScript/webhook.css`.

- [ ] **Step 4: Audit repository state and spec coverage**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -10
```

Expected: no whitespace errors. Confirm that tests or packaged assets cover fence recognition, editable source, defaults, header objects, note payloads, raw POST bodies, content-type inference, inline response text, confetti gating, background color, and main-process validation. Preserve all unrelated pre-existing user changes.

- [ ] **Step 5: Commit verification corrections only when needed**

Stage only the corrected implementation file and its regression test, then run:

```bash
git commit -m "fix: address webhook verification finding"
```

Do not create a commit if verification required no changes.
