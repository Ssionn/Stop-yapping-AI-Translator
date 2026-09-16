// Service worker: extracts page content, calls the selected provider, and
// streams the summary back to the popup over a long-lived port.

import {
  getProvider,
  LENGTH_PRESETS,
  buildSystemPrompt,
  buildUserPrompt,
  buildRequest,
  extractDelta,
  parseResponse,
  detectEmptyReason,
  formatApiError
} from "./lib/providers.js";
import {
  loadSettings,
  resolveModel,
  resolveBaseUrl,
  resolveKey
} from "./lib/settings.js";

const MIN_CONTENT_CHARS = 200;
const ALLOWED_SCHEMES = /^https?:$/;

// Chrome silently drops a suggested shortcut that collides with another
// extension or an OS shortcut, leaving it unassigned. Warn so it's diagnosable.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install") return;
  try {
    const commands = await chrome.commands.getAll();
    const action = commands.find((c) => c.name === "_execute_action");
    if (action && !action.shortcut) {
      console.warn(
        "Stop Yapping: the keyboard shortcut is unassigned (likely a conflict). " +
          "Set one at chrome://extensions/shortcuts"
      );
    }
  } catch {
    /* commands API unavailable */
  }
});

// --- Port protocol ----------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "tldr") return;

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener((msg) => {
    if (msg?.type === "summarize") {
      summarize(port, controller.signal, msg).catch((err) => {
        safePost(port, { type: "error", error: normalizeError(err) });
      });
    } else if (msg?.type === "cancel") {
      controller.abort();
    }
  });
});

async function summarize(port, signal, msg) {
  const settings = await loadSettings();
  const providerId = msg.providerId || settings.providerId;
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const apiKey = resolveKey(settings, providerId);
  if (provider.requiresKey && !apiKey) {
    throw new Error(`No API key set for ${provider.label}. Open Settings to add one.`);
  }

  const page = await extractActiveTab(port, settings.maxInputChars);
  if (signal.aborted) return;

  const model = msg.model || resolveModel(settings, providerId);
  if (!model) throw new Error("No model selected. Open Settings to choose one.");

  const baseUrl = resolveBaseUrl(settings, providerId);
  if (!baseUrl) throw new Error(`No base URL configured for ${provider.label}. Open Settings.`);

  const length = LENGTH_PRESETS[msg.length || settings.length] || LENGTH_PRESETS.tldr;
  const language = msg.language || settings.language;

  const system = buildSystemPrompt(language);
  const user = buildUserPrompt({
    title: page.title,
    url: page.url,
    text: page.text,
    instruction: length.instruction
  });

  const { url, headers, body } = buildRequest({
    provider,
    apiKey,
    model,
    baseUrl,
    system,
    user,
    // Enough headroom for reasoning tokens on thinking-capable models.
    maxTokens: msg.maxTokens || 2000,
    temperature: settings.temperature,
    stream: true
  });

  safePost(port, {
    type: "meta",
    title: page.title,
    url: page.url,
    chars: page.chars,
    providerId,
    model,
    truncated: page.truncated
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(formatApiError(response.status, text));
  }

  let full = "";
  for await (const payload of readSSE(response)) {
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = extractDelta(provider.kind, json);
    if (delta) {
      full += delta;
      safePost(port, { type: "chunk", text: delta });
    }
  }

  if (!full.trim()) throw new Error("The model returned an empty summary. Try a different model.");

  safePost(port, { type: "done", text: full, providerId, model });
}

// --- Non-streaming test used by the options page ----------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "testKey") return undefined;

  testKey(msg)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: normalizeError(err) }));

  return true; // keep the message channel open for the async response
});

async function testKey({ providerId, apiKey, model, baseUrl }) {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Unknown provider: ${providerId}` };

  const key = apiKey || "";
  if (provider.requiresKey && !key) return { ok: false, error: "Add an API key first." };

  const useModel = model || provider.defaultModel;
  if (!useModel) return { ok: false, error: "Choose a model first." };

  const useBaseUrl = baseUrl || provider.baseUrl;
  if (!useBaseUrl) return { ok: false, error: "Add a base URL first." };

  const { url, headers, body } = buildRequest({
    provider,
    apiKey: key,
    model: useModel,
    baseUrl: useBaseUrl,
    system: "You are a connectivity test.",
    user: "Reply with the single word: ok",
    // Reasoning models may spend this whole budget before emitting any answer.
    maxTokens: 1024,
    temperature: 0,
    stream: false
  });

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: formatApiError(res.status, text) };
  }

  const json = await res.json();
  const reply = parseResponse(provider.kind, json).trim();
  if (!reply) {
    const why = detectEmptyReason(provider.kind, json);
    return { ok: true, reply: `(empty reply${why ? ` — ${why}` : ""})` };
  }
  return { ok: true, reply: reply.slice(0, 80) };
}

// --- Page extraction --------------------------------------------------------

async function extractActiveTab(port, maxChars) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error("No active tab found.");

  let scheme = "";
  try {
    scheme = new URL(tab.url || "").protocol;
  } catch {
    /* tab.url may be unavailable for restricted pages */
  }

  if (!ALLOWED_SCHEMES.test(scheme)) {
    throw new Error("This page can't be summarized (browser or extension pages are off limits).");
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageData,
      args: [maxChars]
    });
  } catch (err) {
    throw new Error(`Couldn't read this page: ${err.message}`);
  }

  const data = results?.[0]?.result;
  if (!data || !data.ok) throw new Error("Couldn't find any readable content on this page.");

  if (!data.text || data.text.length < MIN_CONTENT_CHARS) {
    throw new Error(
      "This page has almost no readable text. It may be a PDF, video, or web app."
    );
  }

  safePost(port, { type: "progress", message: "Summarizing…" });
  return data;
}

// Runs inside the page. Must be fully self-contained (it is serialized).
function extractPageData(maxChars) {
  const JUNK_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "IFRAME", "VIDEO", "AUDIO", "FORM",
    "BUTTON", "INPUT", "SELECT", "TEXTAREA", "TEMPLATE", "LINK", "META", "OBJECT",
    "EMBED", "NAV", "HEADER", "FOOTER", "ASIDE"
  ]);
  // Navigation/chrome noise. Comments are handled separately: they are the main
  // content on forums, but noise on articles.
  const JUNK_WORDS =
    /(^|[\s_\-])(nav|navbar|navigation|menu|sidebar|side-bar|footer|header|ad|ads|advert|advertisement|banner|cookie|consent|gdpr|popup|modal|share|sharing|social|related|recommended|recommendation|promo|newsletter|subscribe|subscription|breadcrumb|pagination|pager|skip|toolbar|masthead|widget|sponsor|paywall|signup|login|outbrain|taboola)([\s_\-]|$)/i;
  const COMMENT_WORDS = /(^|[\s_\-])(comment|comments|commentlist|disqus)([\s_\-]|$)/i;
  const BLOCK = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6",
    "BR", "PRE", "BLOCKQUOTE", "TD", "TH", "FIGCAPTION", "DT", "DD", "UL", "OL",
    "TABLE", "HR", "MAIN", "FIGURE"
  ]);

  const normalize = (value) =>
    value
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  // Walks light DOM *and* shadow DOM. `stripComments` removes comment threads.
  const collect = (root, stripComments) => {
    const chunks = [];
    const walk = (node) => {
      if (node.nodeType === 3) {
        const t = node.nodeValue.replace(/\s+/g, " ");
        if (t.trim()) chunks.push(t);
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.tagName;
      if (JUNK_TAGS.has(tag)) return;
      if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return;

      const cls = typeof node.className === "string" ? node.className : "";
      const label = `${node.id || ""} ${cls}`.trim();
      if (label && JUNK_WORDS.test(label)) return;
      if (stripComments && label && COMMENT_WORDS.test(label)) return;

      if (tag === "BR") {
        chunks.push("\n");
        return;
      }
      for (const child of node.childNodes) walk(child);
      // Web components (Reddit's `shreddit-*`, etc.) render into shadow roots.
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) walk(child);
      }
      if (BLOCK.has(tag)) chunks.push("\n");
    };
    walk(root);
    return normalize(chunks.join(" "));
  };

  const roots = [];
  const article = document.querySelector("article");
  // Prefer an article and strip its comment thread.
  if (article) roots.push([article, true]);
  roots.push([document.querySelector("main"), false]);
  roots.push([document.querySelector('[role="main"]'), false]);
  roots.push([document.querySelector("#content, .content, #main, .main, #article, .article"), false]);
  roots.push([document.body, false]);

  let text = "";
  for (const [root, stripComments] of roots) {
    if (!root) continue;
    text = collect(root, stripComments);
    if (text.length >= 500) break;
  }

  // Last resort: the whole body with no keyword filtering at all.
  if (text.length < 500 && document.body) {
    text = collect(document.body, false);
  }

  const original = text.length;
  let truncated = false;

  if (maxChars && text.length > maxChars) {
    const slice = text.slice(0, maxChars);
    const cut = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
    text = `${cut > maxChars * 0.6 ? slice.slice(0, cut + 1) : slice}\n\n[content truncated]`;
    truncated = true;
  }

  return {
    ok: true,
    title: document.title || "",
    url: location.href,
    text,
    chars: original,
    truncated
  };
}

// --- Helpers ----------------------------------------------------------------

async function* readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      yield data;
    }
  }

  // Flush a trailing event that had no terminating newline.
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data && data !== "[DONE]") yield data;
  }
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    /* popup closed while streaming */
  }
}

function normalizeError(err) {
  if (err?.name === "AbortError") return "Cancelled.";
  const message = err?.message || String(err);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
