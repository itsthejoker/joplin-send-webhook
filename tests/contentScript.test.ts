import contentScript from '../src/contentScript';

interface FenceToken {
  info: string;
  content: string;
}

function createRenderer(previousFence?: (...args: unknown[]) => string) {
  const markdownIt = {
    renderer: {
      rules: previousFence ? { fence: previousFence } : {},
    },
  };

  const extension = contentScript({});
  extension.plugin(markdownIt, {});

  return markdownIt.renderer.rules.fence as (...args: unknown[]) => string;
}

function renderWebhook(content: string): string {
  const render = createRenderer();
  return render([{ info: 'webhook-settings', content }], 0, {}, {}, {});
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
    expect(output).toContain('<pre class="joplin-source" data-joplin-language="webhook-settings" data-joplin-source-open="```webhook-settings&NewLine;" data-joplin-source-close="```">');
    expect(output).toContain('<button class="webhook-button" type="button">Deliver</button>');
    expect(output).toContain('<div class="webhook-status" role="status" aria-live="polite"></div>');
    expect(output).toContain('style="--webhook-background:#aabbcc"');

    const encoded = output.match(/data-webhook-settings="([^"]+)"/);
    expect(encoded).not.toBeNull();
    expect(Buffer.from(encoded![1], 'base64').toString('utf8')).toBe(source);
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

  test('declares webview assets in the required order', () => {
    expect(contentScript({}).assets()).toEqual([
      { name: './contentScript/webview.js' },
      { name: './contentScript/webhook.css' },
    ]);
  });

  test('strips one final newline and preserves UTF-8 source exactly', () => {
    const source = 'url=https://example.com\nbutton_text=Café ☕\n';
    const output = renderWebhook(source);
    const encoded = output.match(/data-webhook-settings="([^"]+)"/);

    expect(encoded).not.toBeNull();
    expect(Buffer.from(encoded![1], 'base64').toString('utf8')).toBe(source.slice(0, -1));
    expect(output).toContain('Café ☕');
  });
});
