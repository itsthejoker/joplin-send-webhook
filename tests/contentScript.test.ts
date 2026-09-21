import contentScript from '../src/contentScript';

interface FenceToken {
  info: string;
  content: string;
  markup?: string;
}

function createRenderer(
  previousFence?: (...args: unknown[]) => string,
  context: { contentScriptId?: string } = {},
) {
  const markdownIt = {
    renderer: {
      rules: previousFence ? { fence: previousFence } : {},
    },
  };

  const extension = contentScript(context);
  extension.plugin(markdownIt, {});

  return markdownIt.renderer.rules.fence as (...args: unknown[]) => string;
}

function renderFence(token: FenceToken): string {
  const render = createRenderer();
  return render([token], 0, {}, {}, {});
}

function renderWebhook(content: string): string {
  return renderFence({ info: 'webhook-settings', content });
}

function decodeHtml(value: string): string {
  return value
    .replace(/&NewLine;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readAttribute(output: string, attribute: string): string {
  const matched = output.match(new RegExp(attribute + '="([^"]*)"'));
  expect(matched).not.toBeNull();
  return decodeHtml(matched![1]);
}

function reconstructFencedMarkdown(output: string): string {
  const source = output.match(/<pre class="joplin-source"[^>]*>([\s\S]*?)<\/pre>/);
  expect(source).not.toBeNull();
  return readAttribute(output, 'data-joplin-source-open')
    + decodeHtml(source![1])
    + readAttribute(output, 'data-joplin-source-close');
}

describe('webhook-settings Markdown renderer', () => {
  test('delegates unrelated fences to the previous renderer with unchanged arguments', () => {
    const previousFence = jest.fn(() => '<pre>json</pre>');
    const render = createRenderer(previousFence);
    const args: unknown[] = [[{ info: 'json', content: '{"ok":true}' }], 0, { marker: 'options' }, { marker: 'env' }, { marker: 'self' }];

    expect(render(...args)).toBe('<pre>json</pre>');
    expect(previousFence).toHaveBeenCalledTimes(1);
    expect(previousFence.mock.calls[0]).toEqual(args);
  });

  test('renders a valid webhook control with round-trip source and button semantics', () => {
    const source = 'url=https://example.com/hook\nbutton_text=Deliver\nbackground_color=#aabbcc';
    const output = renderWebhook(source);

    expect(output).toContain('<div class="joplin-editable webhook-control"');
    expect(output).toContain('<pre class="joplin-source" data-joplin-language="webhook-settings" data-joplin-source-open="```webhook-settings&NewLine;" data-joplin-source-close="&NewLine;```">');
    expect(output).toContain('<button class="webhook-button" type="button">Deliver</button>');
    expect(output).toContain('<div class="webhook-status" role="status" aria-live="polite"></div>');
    expect(output).toContain('style="--webhook-background:#aabbcc"');

    const encoded = output.match(/data-webhook-settings="([^"]+)"/);
    expect(encoded).not.toBeNull();
    expect(Buffer.from(encoded![1], 'base64').toString('utf8')).toBe(source);
  });

  test('propagates the Joplin content script ID as an escaped control attribute', () => {
    const render = createRenderer(undefined, { contentScriptId: 'webhook-id-<&"' });
    const output = render([{ info: 'webhook-settings', content: 'url=https://example.com' }], 0, {}, {}, {});

    expect(readAttribute(output, 'data-webhook-content-script-id')).toBe('webhook-id-<&"');
    expect(output).toContain('data-webhook-content-script-id="webhook-id-&lt;&amp;&quot;"');
  });

  test('escapes HTML-sensitive button labels and preserved source', () => {
    const source = 'url=https://example.com\nbutton_text=<script>alert("x" & \'y\')</script>';
    const output = renderWebhook(source);

    expect(output).toContain('&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;');
    expect(output).not.toContain('<script>');
  });

  test('renders invalid settings as a disabled control with escaped validation errors', () => {
    const output = renderWebhook('url=file:///tmp/<bad>&"\'\nunknown<script>=value');

    expect(output).toContain('<button class="webhook-button" type="button" disabled>Invalid webhook settings</button>');
    expect(output).toContain('url must use http or https.');
    expect(output).toContain('Unknown setting: unknown&lt;script&gt;.');
    expect(output).not.toContain('Unknown setting: unknown<script>.');
    expect(output).not.toContain('style="--webhook-background:');
  });

  test('uses the default button label when button_text is omitted', () => {
    expect(renderWebhook('url=https://example.com')).toContain('>Send Webhook</button>');
  });

  test('declares archive-root webview assets in CSS then JS order', () => {
    const assets = contentScript({}).assets();

    expect(assets).toEqual([
      { name: 'webhook.css' },
      { name: 'webview.js' },
    ]);
    expect(assets.every((asset: { name: string }) => !asset.name.includes('/'))).toBe(true);
  });

  test('strips one final newline and preserves UTF-8 source exactly', () => {
    const source = 'url=https://example.com\nbutton_text=Café ☕\n';
    const output = renderWebhook(source);
    const encoded = output.match(/data-webhook-settings="([^"]+)"/);

    expect(encoded).not.toBeNull();
    expect(Buffer.from(encoded![1], 'base64').toString('utf8')).toBe(source.slice(0, -1));
    expect(output).toContain('Café ☕');
  });

  test('reconstructs the original fenced Markdown using decoded source metadata', () => {
    const source = 'url=https://example.com\nbutton_text=Deliver';
    const output = renderWebhook(source + '\n');

    expect(reconstructFencedMarkdown(output)).toBe('```webhook-settings\n' + source + '\n```');
  });

  test('preserves tilde delimiters in round-trip source metadata', () => {
    const source = 'url=https://example.com\n# ~~~';
    const output = renderFence({ info: ' webhook-settings ', markup: '~~~', content: source + '\n' });

    expect(reconstructFencedMarkdown(output)).toBe('~~~ webhook-settings \n' + source + '\n~~~');
  });

  test('preserves four-backtick delimiters when source contains triple backticks', () => {
    const source = 'url=https://example.com\n# ```';
    const output = renderFence({ info: 'webhook-settings', markup: '````', content: source + '\n' });

    expect(reconstructFencedMarkdown(output)).toBe('````webhook-settings\n' + source + '\n````');
  });

  test('uses safe basic code markup when no prior fence renderer exists', () => {
    const render = createRenderer();

    expect(render([{ info: 'json', content: '<script>' }], 0, {}, {}, {}))
      .toBe('<pre><code class="language-json">&lt;script&gt;</code></pre>');
  });
});
