# Webhook Button Plugin Design

## Goal

Turn a fenced `webhook-settings` block in a Joplin Markdown note into a simple control for sending an HTTP POST request. The rendered control lets a user publish either an inline payload or the Markdown body of another Joplin note, then shows clear success or failure feedback.

## Configuration format

The plugin recognizes fenced blocks whose language is exactly `webhook-settings`:

````markdown
```webhook-settings
# Lines beginning with # are comments.
url=https://example.com/webhook
data=@123456789
headers={"x-auth":"asdfasdf","x-abc":"def"}
success_confetti=false
print_response=true
button_text=Publish Blog
background_color=#b2e5e9
```
````

Each non-comment, non-blank line is a `key=value` pair split at the first equals sign. This preserves equals signs inside URLs, payloads, and header values. Supported keys are:

- `url`: Required HTTP or HTTPS endpoint.
- `data`: Optional raw request body. A value beginning with `@` is a Joplin note ID reference. Any other value is interpreted as JSON when it is valid JSON and as plain text otherwise.
- `headers`: Optional JSON object containing string header names and values.
- `success_confetti`: Optional strict boolean; defaults to `false`.
- `print_response`: Optional strict boolean; defaults to `false`.
- `button_text`: Optional non-empty label; defaults to `Send Webhook`.
- `background_color`: Optional CSS color applied only to the generated control area; by default, the current Joplin theme remains visible.

Malformed lines, duplicate keys, unknown keys, invalid booleans, a missing or unsupported URL, invalid headers, and invalid colors produce a visible configuration error and a disabled send button. This makes misspellings fail safely rather than silently changing request behavior.

## Architecture

### Markdown renderer

A Markdown-It content script registers a fence rule for `webhook-settings`. It parses and validates the configuration and replaces that fence with a centered control containing the configured button and a live status area. Other fenced blocks and the rest of the note render normally.

The generated markup uses Joplin's `joplin-editable` and `joplin-source` structure so switching through the Rich Text Editor preserves the original fenced Markdown. User-controlled values are escaped before being placed in markup. Status and response content are inserted as text, never interpreted as HTML.

The content script declares bundled JavaScript and CSS assets. CSS is scoped to the generated control. The viewer script owns button state, calls Joplin's content-script message bridge, and renders the returned result.

### Main plugin process

The main plugin registers the Markdown-It content script and its message handler. The handler independently validates the received configuration before performing any privileged work; renderer validation is only for early feedback.

When `data` starts with `@`, the handler loads that note through Joplin's data API and uses only its Markdown `body` as the payload. A missing or inaccessible note returns a user-facing error. Literal JSON is serialized as JSON, while all other literal values and referenced note bodies are sent as text.

The plugin sends one POST request to the configured endpoint. Configured headers are preserved. If the user did not provide a case-insensitive `Content-Type` header, the plugin adds `application/json` for JSON data or `text/plain;charset=UTF-8` for text data. An omitted `data` value produces an empty body and does not add a content type.

### Result contract

The main process always returns a serializable result object rather than exposing internal exceptions. A successful transport result contains the HTTP status, status text, response body as text, and an `ok` flag based on the response's `2xx` status. A failure contains a safe error message. Request headers, payload data, and stack traces are never echoed in errors.

## Interaction behavior

Clicking the button disables it and changes its label to `Sending…`, preventing duplicate requests until the first request settles. It is then restored to its configured label.

Any `2xx` response is a success. Other HTTP statuses are failures but remain valid response results. The status area always shows compact success or error feedback. With `print_response=true`, it additionally shows the numeric HTTP status, status text, and response body beneath the button using preformatted, wrapping text. Empty response bodies are represented clearly.

With `success_confetti=true`, a small local confetti animation runs only after a `2xx` response. It has no network dependency, does not cover Joplin indefinitely, respects reduced-motion preferences, and does not run for failures.

Network failures, invalid configurations, malformed referenced note IDs, and unreadable responses are displayed inline. The UI never replaces the note's Markdown or mutates either the source note or a referenced payload note.

## Security and boundaries

- Only `http://` and `https://` URLs are allowed.
- The feature intentionally permits arbitrary user-selected endpoints, including endpoints on a local network.
- Header names and values must be strings and must satisfy the runtime request implementation.
- Response bodies are displayed as text to prevent script or markup injection.
- Configuration is validated in the main process even if the viewer sends a handcrafted message.
- The first release sends one request per click and does not add retries, authentication storage, templating, request history, or response persistence.

## Testing strategy

Implementation follows test-driven development around independently testable modules.

Unit tests cover line parsing, first-equals splitting, comments and blank lines, defaults, duplicate and unknown keys, strict booleans, header-object validation, URL protocols, CSS color validation, inline JSON detection, and note-reference detection. Renderer tests cover matching only the intended fence, preserving the Joplin editable source, escaped user content, disabled invalid controls, and scoped configuration markup.

Request-service tests cover referenced-note resolution, raw payload selection, content-type inference and override, header forwarding, empty bodies, `2xx` and non-`2xx` results, and safe network errors. Viewer behavior is kept small and exercised for pending state, compact feedback, optional response output, and confetti gating where the project's test environment can represent DOM behavior reliably.

Final verification consists of the full automated test suite, TypeScript checking through the production build, and successful creation of the Joplin plugin archive.

## Documentation

The README will explain installation, the complete configuration schema, payload rules, header syntax, defaults, security implications, and example configurations for inline JSON, plain text, and referenced-note bodies.
