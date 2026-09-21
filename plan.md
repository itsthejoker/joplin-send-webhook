The goal of this plugin is to create a plugin that, when it detects a page with properly-formatted front matter, convert the rendered version of that page
into a simple control interface for sending a webhook. Example front matter:

```webhook-settings
# do not remove this block
url=https://example.com/webhook
#data={"hello", "world"}
data=@123456789
headers=[{"x-auth": "asdfasdf"}, {"x-abc": "def"}]
success_confetti=false
print_response=true
button_text=Publish Blog
background_color=#b2e5e9
```

When front matter starting with "```webhook-settings" is detected, the rendered version of the page should be have a large centered button with the text
specified by the user. When clicked, this button should trigger a POST request to the target with the accompanying url. the "data" value can be either 
JSON or a string starting with `@` -- if starts with the @ symbol, then it's a reference to an internal Joplin note ID. In that case, all the content of
that note should be sent as the encoded data parameter. The `background_color` field should change the background color of the rendered note, so if the
user has multiple notes with buttons, they can make the notes easier to tell apart.
