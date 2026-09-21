# Webhook Button

Webhook Button turns a fenced block in a Joplin note into a button. Clicking the
rendered button sends an HTTP `POST` webhook and shows the result in the note.
This makes a note a lightweight, explicit trigger for an automation without
leaving Joplin.

## Install

Build the plugin, then install the generated JPL in Joplin Desktop:

```sh
npm run dist
```

In Joplin, open **Settings/Options → Plugins → Install from file**, choose
`publish/com.joekaufeld.sendwebhook.jpl`, then restart Joplin or enable the
plugin if Joplin asks you to do so.

## Create a button

Add an exact `webhook-settings` fenced block to a Markdown note. For example:

````markdown
```webhook-settings
url=https://example.com/hooks/deploy
headers={"Authorization":"Bearer example-token","X-Source":"joplin"}
data={"environment":"production","action":"deploy"}
success_confetti=true
print_response=true
button_text=Deploy production
background_color=#2563eb
```
````

The rendered note shows a **Deploy production** button. It sends the JSON body
and headers above with a `POST` request.

Each non-comment setting occupies one line and has the form `key=value`. The
line is split at the first `=` only, so values may contain additional equals
signs. Blank lines and lines beginning with `#` are ignored. Unknown,
duplicate, or malformed settings leave the control disabled and display an
inline error in the rendered note.

### Plain text body

Use a value that is not valid JSON for a literal text payload:

````markdown
```webhook-settings
url=https://example.com/hooks/notify
data=Deployment completed for production
button_text=Notify team
```
````

### Use another note as the body

Prefix a Joplin note ID with `@` to send that note's Markdown body:

````markdown
```webhook-settings
url=https://example.com/hooks/archive
data=@0123456789abcdef0123456789abcdef
headers={"X-Document-Type":"text/markdown"}
button_text=Archive this document
```
````

Replace the illustrative 32-character ID with the ID of the source note.

## Settings reference

| Key | Required / default | Behavior |
| --- | --- | --- |
| `url` | Required | Absolute `http` or `https` endpoint to receive the `POST`. |
| `data` | Optional; no request body | Valid JSON is serialized as JSON. Other text is sent literally. `@noteID` reads that note's Markdown body. |
| `headers` | Optional; `{}` | A JSON object whose keys and values are strings, for example `{"Authorization":"Bearer token"}`. Header names must be valid HTTP names and values cannot contain NUL, CR, or LF. Do not use a preformatted header string or a list. |
| `success_confetti` | Optional; `false` | Must be exactly `true` or `false`. `true` shows confetti after a successful response. |
| `print_response` | Optional; `false` | Must be exactly `true` or `false`. `true` displays the full textual response below the status. |
| `button_text` | Optional; `Send Webhook` | Label shown on the button; it cannot be empty. |
| `background_color` | Optional | Button background: supported CSS color keyword, hex color, or `rgb`/`rgba`/`hsl`/`hsla` value. |

The request body is always sent as raw text—there is no form encoding. When
`data` is JSON, the plugin infers `Content-Type: application/json`; for literal
text or a referenced note, it infers `Content-Type: text/plain;charset=UTF-8`.
It adds an inferred content type only when `headers` does not already contain a
`Content-Type` header (case-insensitive). With no `data`, it sends no body and
does not infer a content type.

## Result and safety

While a request is running, the button is disabled and shows **Sending…**.
Afterward it is enabled again and the note receives a compact status: success
for a successful HTTP response, or the response status for a non-successful
one. `print_response=true` adds the full response as text, not rendered HTML.
`success_confetti=true` adds a small success celebration only for successful
responses and respects the system reduced-motion preference.

Webhook Button can send to arbitrary endpoints, including local-network
addresses. Review notes received from other people before clicking a button:
their configured headers and payload are sent to the endpoint. Response bodies
are rendered as text and are not persisted by the plugin; requests have no
automatic retry or persistence. Transport and other request failures use a safe
generic error message rather than exposing underlying details.

## Development

```sh
npm test
npm run dist
```

The distributable archive is written to
`publish/com.joekaufeld.sendwebhook.jpl`.
