// Provider registry + request/response adapters for the three API "shapes"
// the extension supports: OpenAI-compatible, Anthropic, and Google Gemini.
//
// Model IDs verified 2026-09-16 against each provider's official docs.
// Providers marked `editableModels` take a free-text model name instead of a
// fixed list, so local/custom endpoints never go stale.

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyUrl: "https://console.anthropic.com/settings/keys",
    requiresKey: true,
    models: [
      "claude-haiku-4-5",
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-fable-5-1"
    ],
    defaultModel: "claude-haiku-4-5"
  },

  openai: {
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    requiresKey: true,
    tokenParam: "max_completion_tokens",
    // Reasoning models reject custom temperature and accept reasoning_effort.
    noTemperature: true,
    reasoningBody: { reasoning_effort: "low" },
    models: [
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-6-astra"
    ],
    defaultModel: "gpt-5.6-luna"
  },

  deepseek: {
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys",
    requiresKey: true,
    // Summarizing needs no chain-of-thought, and thinking mode is on by default
    // (default effort `high`), which otherwise eats the whole output budget.
    reasoningBody: { thinking: { type: "disabled" } },
    // `deepseek-flash` is DeepSeek-V4.1-Flash (current). The `v4-flash*` names
    // are still accepted aliases and are served by the same V4.1-Flash model.
    models: [
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro"
    ],
    defaultModel: "deepseek-flash"
  },

  google: {
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyUrl: "https://aistudio.google.com/app/apikey",
    requiresKey: true,
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro"
    ],
    defaultModel: "gemini-3.8-flash"
  },

  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    requiresKey: true,
    models: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "groq/compound-mini",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen/qwen3.8-27b"
    ],
    defaultModel: "openai/gpt-oss-120b"
  },

  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    requiresKey: true,
    models: [
      "openai/gpt-5.6-luna",
      "anthropic/claude-sonnet-5",
      "google/gemini-3.8-flash",
      "deepseek/deepseek-v4.1-flash",
      "x-ai/grok-4.6",
      "mistralai/mistral-medium-3-5",
      "qwen/qwen3.8-flash",
      "meta-llama/llama-4-maverick"
    ],
    defaultModel: "openai/gpt-5.6-luna",
    extraHeaders: {
      "HTTP-Referer": "https://github.com/tldr-extension",
      "X-Title": "Stop Yapping"
    }
  },

  mistral: {
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys/",
    requiresKey: true,
    models: [
      "mistral-small-2603",
      "mistral-medium-3-5",
      "mistral-large-2512",
      "ministral-8b-2512",
      "ministral-3b-2512"
    ],
    defaultModel: "mistral-small-2603"
  },

  xai: {
    label: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai/",
    requiresKey: true,
    models: [
      "grok-build-0.1",
      "grok-4.3",
      "grok-4.5",
      "grok-4.6",
      "grok-4.20"
    ],
    defaultModel: "grok-4.3"
  },

  ollama: {
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    requiresKey: false,
    editableModels: true,
    models: ["gemma4", "qwen3.8", "qwen3.6", "qwen3.5", "gpt-oss", "glm-4.7-flash", "llama3.3"],
    defaultModel: "gemma4"
  },

  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    requiresKey: true,
    editableModels: true,
    models: [],
    defaultModel: ""
  }
};

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

// Maps the user's chosen output style to prompt instructions.
export const LENGTH_PRESETS = {
  tldr: {
    label: "TL;DR",
    instruction:
      "Produce the shortest useful summary: one bolded TL;DR sentence, then at most 3 tight bullet points. No preamble."
  },
  bullets: {
    label: "Bullets",
    instruction:
      "Summarize as 5-8 concise bullet points capturing the key facts, arguments, and any numbers. No preamble."
  },
  summary: {
    label: "Summary",
    instruction:
      "Write a 1-2 short paragraph summary, then 3-5 key takeaways as bullets. No preamble."
  },
  detailed: {
    label: "Detailed",
    instruction:
      "Write a structured summary: a short overview paragraph, then sections for Key Points, Important Details, and Takeaways. No preamble."
  }
};

export function buildSystemPrompt(language) {
  const lang = language && language.trim() ? language.trim() : "English";
  return [
    "You are a precise webpage summarizer. You are given the extracted text of a single web page.",
    `Always answer in ${lang}, regardless of the language of the page.`,
    "Only use information present in the page. Never invent facts, quotes, or numbers.",
    "If the text is paywalled, empty, or clearly not real article content, say so in one line instead of guessing.",
    "Output plain text using short markdown (bold and '- ' bullets). Do not include a preamble like 'Here is a summary'."
  ].join(" ");
}

export function buildUserPrompt({ title, url, text, instruction }) {
  return [
    `Title: ${title || "(untitled)"}`,
    `URL: ${url || "(unknown)"}`,
    "",
    "Task:",
    instruction,
    "",
    "Page content:",
    '"""',
    text,
    '"""'
  ].join("\n");
}

// --- Request builders -------------------------------------------------------

export function buildRequest({
  provider,
  apiKey,
  model,
  baseUrl,
  system,
  user,
  maxTokens = 700,
  temperature = 0.2,
  stream = true
}) {
  const kind = provider.kind;
  const root = trimSlash(baseUrl || provider.baseUrl);

  if (kind === "anthropic") {
    return {
      url: `${root}/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required for browser-based (non-server) calls.
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: user }],
        stream
      }
    };
  }

  if (kind === "gemini") {
    return {
      url: `${root}/models/${encodeURIComponent(model)}:${
        stream ? "streamGenerateContent?alt=sse&" : "generateContent?"
      }key=${encodeURIComponent(apiKey)}`,
      headers: { "content-type": "application/json" },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature }
      }
    };
  }

  // OpenAI-compatible chat completions. Reasoning models reject `max_tokens`,
  // so providers can override the parameter name via `tokenParam`.
  const tokenParam = provider.tokenParam || "max_tokens";
  const body = {
    model,
    stream,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  if (!provider.noTemperature) body.temperature = temperature;
  if (provider.reasoningBody) Object.assign(body, provider.reasoningBody);
  body[tokenParam] = maxTokens;

  const headers = {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(provider.extraHeaders || {})
  };

  return { url: `${root}/chat/completions`, headers, body };
}

// --- Response parsing -------------------------------------------------------

// Pulls the incremental text out of a single streamed event payload.
export function extractDelta(kind, json) {
  if (!json) return "";
  if (kind === "anthropic") {
    if (json.type === "content_block_delta" && json.delta && json.delta.type === "text_delta") {
      return json.delta.text || "";
    }
    return "";
  }
  if (kind === "gemini") {
    // `thought: true` parts are the model's reasoning, not the answer.
    const parts = json.candidates?.[0]?.content?.parts || [];
    return parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
  }
  const choice = json.choices?.[0];
  return choice?.delta?.content || choice?.message?.content || "";
}

// Pulls the full text out of a non-streamed response.
export function parseResponse(kind, json) {
  if (kind === "anthropic") {
    return (json.content || []).map((b) => b.text || "").join("");
  }
  if (kind === "gemini") {
    const parts = json.candidates?.[0]?.content?.parts || [];
    return parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
  }
  return json.choices?.[0]?.message?.content || "";
}

// Explains a 200 response that contains no answer text — almost always the
// output budget being consumed by reasoning tokens.
export function detectEmptyReason(kind, json) {
  if (kind === "gemini") {
    const blocked = json.promptFeedback?.blockReason;
    if (blocked) return `blocked by safety filter: ${blocked}`;
    const finish = json.candidates?.[0]?.finishReason;
    return finish ? `finishReason: ${finish}` : "";
  }
  if (kind === "anthropic") {
    return json.stop_reason ? `stop_reason: ${json.stop_reason}` : "";
  }
  const choice = json.choices?.[0];
  const notes = [];
  if (choice?.finish_reason) notes.push(`finish_reason: ${choice.finish_reason}`);
  if (choice?.message?.reasoning_content) notes.push("model returned only reasoning_content");
  return notes.join("; ");
}

// Turns a provider error response into a readable message.
export function formatApiError(status, bodyText) {
  let detail = bodyText || "";
  try {
    const json = JSON.parse(bodyText);
    detail = json.error?.message || json.error?.type || json.message || json.detail || bodyText;
  } catch {
    /* body was not JSON */
  }
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}). Check your API key in Settings. ${detail}`.trim();
  }
  if (status === 429) {
    return `Rate limit or quota exceeded (429). ${detail}`.trim();
  }
  if (status === 400 || status === 404) {
    return `Request rejected (${status}) — the model ID may be wrong. ${detail}`.slice(0, 400);
  }
  return `Request failed (${status}). ${detail}`.slice(0, 400);
}

function trimSlash(url) {
  return (url || "").replace(/\/+$/, "");
}
