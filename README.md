# Simple Network Copy

A Chrome DevTools extension that lists network requests and copies selected ones as clean Markdown — ideal for sharing with AI assistants or documenting API flows.

## Features

- **DevTools panel** — appears as "Network Copy" in Chrome DevTools (F12)
- **Request list** — method, status, type, URL, and response size
- **Multi-select** — checkboxes with Select all / Clear selection
- **Copy as Markdown** — Method, URL, Status, Duration, Payload, and Response for each selected request
- **Include headers** — optional toggle for request and response headers
- **Truncate large bodies** — optional toggle with editable size limit (default: 3 MB)
- **Filters** — by URL, Fetch/XHR (JavaScript-initiated requests), and API (JSON/XML response bodies)

## Install (unpacked)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select this folder
5. Open DevTools on any page — you'll see a **Network Copy** tab

## Usage

1. Open DevTools (**F12**) and switch to the **Network Copy** panel
2. Reload the page or interact with it (requests are captured while DevTools is open)
3. Optionally filter with **Fetch/XHR**, **API**, or the URL search box (filters combine with AND)
4. Select the requests you want with the checkboxes
5. Optionally enable **Include headers** or adjust **Truncate bodies over X MB**
6. Click **Copy (N)** — the Markdown is on your clipboard

### Example output

````markdown
## Request 1

- Method: POST
- URL: https://api.example.com/users
- Status: 201
- Duration: 142 ms
- Timing: TTFB 98 ms · download 44 ms

### Payload

```json
{"name": "Jane"}
```

### Response

```json
{"id": 1, "name": "Jane"}
```
````

Multiple requests are separated by `---`.

## Limitations

- Requests are only captured **while DevTools is open** (Chrome API limitation)
- Binary response bodies are replaced with `[binary content — not included]`
- Very large bodies can be truncated when the toggle is enabled

## License

MIT
