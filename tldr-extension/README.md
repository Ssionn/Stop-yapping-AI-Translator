# Stop Yapping — AI Translator

Stop reading yapping. A Chrome (Manifest V3) extension that translates the page you're on into a
30-second summary, using **your own API key**. No account, no backend, no telemetry — your browser
talks straight to the provider you pick.

## Features

- One-click summary of the current page, streamed token-by-token.
- Bring your own key for **Anthropic, OpenAI, DeepSeek, Google Gemini, Groq, OpenRouter, Mistral, xAI (Grok)**, plus **Ollama** and any **custom OpenAI-compatible endpoint**.
- Four output styles: TL;DR, Bullets, Summary, Detailed.
- Choose the output language independently of the page language.
- Smart readability-style extraction (drops nav/ads/cookie banners) with length capping.
- Per-session caching, so reopening the popup is instant.
- "Test" button per provider to verify a key before you rely on it.
- Keyboard shortcut: `Ctrl+Shift+Y` (`Cmd+Shift+Y` on macOS). Rebind at `chrome://extensions/shortcuts`.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `tldr-extension` folder.
4. Click the extension's **Settings** (or right-click the toolbar icon → Options).
5. Paste an API key for at least one provider and pick a model. Click **Test** to confirm.
6. Open any article and click the toolbar icon → **Summarize page**.

## Supported providers

| Provider | API style | Key required |
| --- | --- | --- |
| Anthropic | Messages API | yes |
| OpenAI | Chat Completions | yes |
| DeepSeek | Chat Completions | yes |
| Google Gemini | generateContent / SSE | yes |
| Groq | Chat Completions | yes |
| OpenRouter | Chat Completions | yes |
| Mistral | Chat Completions | yes |
| xAI (Grok) | Chat Completions | yes |
| Ollama (local) | Chat Completions | no |
| Custom | Chat Completions | optional |

Known providers are pre-authorized for network access. For **Ollama** and **Custom** endpoints,
Chrome asks for host permission the first time you save/grant access (user-gesture required).

## Project layout

```
manifest.json        MV3 manifest (service worker, permissions, commands)
background.js        Service worker: extraction, streaming fetch, message protocol
lib/providers.js     Provider registry + request builders + response/SSE adapters
lib/settings.js      Settings model backed by chrome.storage.local
popup.html/.css/.js  Toolbar popup: pick provider/model/style, stream the summary
options.html/.css/.js  API keys, models, defaults, custom endpoint, reset
theme.css            Shared design tokens (light + dark)
icons/               Generated PNG icons
```

## How it works

1. The popup opens a long-lived port to the service worker.
2. The worker injects a readability heuristic into the active tab and extracts clean text (capped at `maxInputChars`).
3. It builds a provider-specific request and streams the SSE response, forwarding deltas to the popup.
4. If the popup closes, the request is aborted so you don't burn tokens.

## Privacy

- API keys live in `chrome.storage.local` for this profile only. They are sent **only** to the provider you selected, as the `Authorization`/`x-api-key`/`key` parameter.
- Page text is sent **only** to the provider you selected, only when you press Summarize.
- There is no analytics, no remote config, and no first-party server.
- Keys are not encrypted at rest — anyone with access to your OS profile can read them. Use scoped keys and rotate them.

## Development

No build step. Edit files and hit **Reload** on `chrome://extensions`.

The service worker is an ES module, so `lib/*.js` can be imported directly from `background.js`
and from the popup/options pages.

To sanity-check syntax without Chrome:

```powershell
node --check background.js
```
