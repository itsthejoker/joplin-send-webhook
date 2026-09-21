import { parseWebhookSettings } from '../webhookConfig';

type FenceRenderer = (...args: any[]) => string;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackFence(tokens: any[], index: number): string {
  const token = tokens[index];
  return '<pre><code>' + escapeHtml(token && token.content ? token.content : '') + '</code></pre>';
}

function renderWebhookSettings(source: string): string {
  const result = parseWebhookSettings(source);
  const encodedSource = escapeHtml(Buffer.from(source, 'utf8').toString('base64'));
  let label: string;
  let error: string;
  let style = '';
  let disabled = '';

  if (result.ok === true) {
    label = result.config.buttonText;
    if (result.config.backgroundColor) {
      style = ' style="--webhook-background:' + escapeHtml(result.config.backgroundColor) + '"';
    }
    error = '';
  } else {
    label = 'Invalid webhook settings';
    error = result.errors.join(' ');
    disabled = ' disabled';
  }

  return '<div class="joplin-editable webhook-control" data-webhook-settings="' + encodedSource + '"' + style + '>'
    + '<pre class="joplin-source" data-joplin-language="webhook-settings" data-joplin-source-open="```webhook-settings&NewLine;" data-joplin-source-close="```">' + escapeHtml(source) + '</pre>'
    + '<button class="webhook-button" type="button"' + disabled + '>' + escapeHtml(label) + '</button>'
    + '<div class="webhook-status" role="status" aria-live="polite">' + escapeHtml(error) + '</div>'
    + '</div>';
}

export default function contentScript(_context: unknown) {
  return {
    plugin(markdownIt: any, _options: unknown) {
      const previousFence: FenceRenderer = markdownIt.renderer.rules.fence || fallbackFence;

      markdownIt.renderer.rules.fence = function(...args: any[]): string {
        const token = args[0][args[1]];
        if (!token || String(token.info || '').trim() !== 'webhook-settings') {
          return previousFence.apply(this, args);
        }

        const content = String(token.content || '');
        const source = content.endsWith('\n') ? content.slice(0, -1) : content;
        return renderWebhookSettings(source);
      };
    },

    assets() {
      return [
        { name: './contentScript/webview.js' },
        { name: './contentScript/webhook.css' },
      ];
    },
  };
}
