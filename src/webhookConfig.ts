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

const CSS_NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'currentcolor', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick',
  'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
  'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred', 'indigo',
  'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
  'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'magenta',
  'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite',
  'navy', 'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink',
  'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver',
  'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue',
  'tan', 'teal', 'thistle', 'tomato', 'transparent', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
]);
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function parseWebhookSettings(source: string): ParseResult {
  const settings: Record<string, string> = Object.create(null) as Record<string, string>;
  const errors: string[] = [];
  const supportedKeys = [
    'url',
    'data',
    'headers',
    'success_confetti',
    'print_response',
    'button_text',
    'background_color',
  ];

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return;

    const equalsIndex = trimmed.indexOf('=');
    const key = equalsIndex === -1 ? '' : trimmed.slice(0, equalsIndex).trim();
    if (!key) {
      errors.push('Line ' + (index + 1) + ' must be a key=value pair.');
      return;
    }

    if (supportedKeys.indexOf(key) === -1) {
      errors.push('Unknown setting: ' + key + '.');
      return;
    }

    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      errors.push('Duplicate setting: ' + key + '.');
      return;
    }

    settings[key] = trimmed.slice(equalsIndex + 1).trim();
  });

  const url = settings.url;
  if (!url) {
    errors.push('url is required.');
  } else {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        errors.push('url must use http or https.');
      }
    } catch (_) {
      errors.push('url must be a valid absolute URL.');
    }
  }

  const data = settings.data;
  let payload: WebhookPayload = { kind: 'empty' };
  if (data !== undefined) {
    if (data.charAt(0) === '@') {
      const noteId = data.slice(1);
      if (!noteId) {
        errors.push('data note ID must not be empty.');
      } else {
        payload = { kind: 'note', noteId };
      }
    } else {
      try {
        payload = { kind: 'json', value: JSON.parse(data) };
      } catch (_) {
        payload = { kind: 'text', value: data };
      }
    }
  }

  let headers: Record<string, string> = {};
  if (settings.headers !== undefined) {
    try {
      const parsedHeaders: unknown = JSON.parse(settings.headers);
      if (!parsedHeaders || Array.isArray(parsedHeaders) || typeof parsedHeaders !== 'object') {
        errors.push('headers must be a JSON object with string values.');
      } else {
        const candidate = parsedHeaders as Record<string, unknown>;
        const headerNames = Object.keys(candidate);
        let validHeaders = true;
        for (let i = 0; i < headerNames.length; i += 1) {
          const headerName = headerNames[i];
          const headerValue = candidate[headerName];
          if (typeof headerValue !== 'string') {
            if (errors.indexOf('headers must be a JSON object with string values.') === -1) {
              errors.push('headers must be a JSON object with string values.');
            }
            validHeaders = false;
            continue;
          }
          if (!HTTP_HEADER_NAME_PATTERN.test(headerName)) {
            errors.push('headers contains invalid header name ' + JSON.stringify(headerName) + '.');
            validHeaders = false;
            continue;
          }
          if (/[\0\r\n]/.test(headerValue)) {
            errors.push('Header ' + JSON.stringify(headerName) + ' must not contain NUL, CR, or LF.');
            validHeaders = false;
          }
        }
        if (validHeaders) {
          headers = candidate as Record<string, string>;
        }
      }
    } catch (_) {
      errors.push('headers must be a JSON object with string values.');
    }
  }

  const successConfetti = parseBooleanSetting('success_confetti', settings.success_confetti, errors);
  const printResponse = parseBooleanSetting('print_response', settings.print_response, errors);

  const buttonText = settings.button_text === undefined ? 'Send Webhook' : settings.button_text;
  if (!buttonText) {
    errors.push('button_text must not be empty.');
  }

  if (settings.background_color !== undefined && !isSupportedColor(settings.background_color)) {
    errors.push('background_color is not a supported color.');
  }

  if (errors.length > 0) return { ok: false, errors };

  const config: WebhookConfig = {
    url,
    payload,
    headers,
    successConfetti,
    printResponse,
    buttonText,
  };

  if (settings.background_color !== undefined) {
    config.backgroundColor = settings.background_color;
  }

  return { ok: true, config };
}

function parseBooleanSetting(key: string, value: string | undefined, errors: string[]): boolean {
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;

  errors.push(key + ' must be true or false.');
  return false;
}

function isSupportedColor(value: string): boolean {
  if (/^#[0-9a-fA-F]{3,4}$/.test(value) || /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)) {
    return true;
  }

  if (CSS_NAMED_COLORS.has(value.toLowerCase())) return true;

  const number = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const colorComponent = number + '%?';
  const alphaComponent = number + '%?';
  const separator = '\\s*,\\s*';
  const rgb = '^rgb\\(\\s*' + colorComponent + separator + colorComponent + separator + colorComponent + '\\s*\\)$';
  const rgba = '^rgba\\(\\s*' + colorComponent + separator + colorComponent + separator + colorComponent + separator + alphaComponent + '\\s*\\)$';
  const hsl = '^hsl\\(\\s*' + number + separator + number + '%' + separator + number + '%' + '\\s*\\)$';
  const hsla = '^hsla\\(\\s*' + number + separator + number + '%' + separator + number + '%' + separator + alphaComponent + '\\s*\\)$';

  return new RegExp(rgb, 'i').test(value)
    || new RegExp(rgba, 'i').test(value)
    || new RegExp(hsl, 'i').test(value)
    || new RegExp(hsla, 'i').test(value);
}
