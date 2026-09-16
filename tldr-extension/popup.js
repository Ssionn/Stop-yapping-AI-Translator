import { PROVIDERS } from "./lib/providers.js";
import { loadSettings, saveSettings, resolveModel } from "./lib/settings.js";

const $ = (id) => document.getElementById(id);

const providerSelect = $("provider");
const modelField = $("model-field");
let modelControl = null; // <select> or <input>, rebuilt when the provider changes
const lengthRow = $("length-row");
const actionBtn = $("action");
const copyBtn = $("copy");
const resultEl = $("result");
const outputEl = $("output");
const statusEl = $("status");
const emptyState = $("empty-state");
const pageMeta = $("page-meta");
const pageTitle = $("page-title");
const pageChars = $("page-chars");

let settings = null;
let state = "idle"; // idle | running
let fullText = "";
let port = null;
let currentTabUrl = "";

init();

async function init() {
  settings = await loadSettings();
  currentTabUrl = await getActiveTabUrl();

  populateProviders();
  syncProviderUI();
  syncLengthChips();

  providerSelect.addEventListener("change", onProviderChange);
  lengthRow.addEventListener("click", onLengthClick);
  actionBtn.addEventListener("click", onAction);
  copyBtn.addEventListener("click", onCopy);
  $("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const cached = await readCache();
  if (cached) {
    renderResult(cached);
    return;
  }
  if (settings.autoSummarize) start();
}

// --- UI sync ----------------------------------------------------------------

function populateProviders() {
  providerSelect.innerHTML = "";
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement("option");
    opt.value = id;
    const ready = !p.requiresKey || Boolean(settings.keys[id]);
    opt.textContent = ready ? p.label : `${p.label} — no key`;
    providerSelect.appendChild(opt);
  }
  providerSelect.value = settings.providerId;
}

function syncProviderUI() {
  const providerId = providerSelect.value;
  const provider = PROVIDERS[providerId];
  const stored = resolveModel(settings, providerId);

  modelField.querySelectorAll("select, input").forEach((node) => node.remove());

  if (provider.editableModels) {
    const input = document.createElement("input");
    input.type = "text";
    input.id = "model";
    input.value = stored || provider.defaultModel || "";
    input.placeholder = provider.defaultModel || "model name";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("change", onModelChange);
    modelField.appendChild(input);
    modelControl = input;
  } else {
    const select = document.createElement("select");
    select.id = "model";
    const options = [...provider.models];
    // Keep a previously chosen model visible even if it's no longer in the list.
    if (stored && !options.includes(stored)) options.unshift(stored);
    for (const m of options) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    }
    select.value = stored || options[0] || "";
    select.addEventListener("change", onModelChange);
    modelField.appendChild(select);
    modelControl = select;
  }

  updateActionState();
}

function getModelValue() {
  return modelControl?.value.trim() || "";
}

function syncLengthChips() {
  for (const chip of lengthRow.querySelectorAll(".chip")) {
    chip.classList.toggle("active", chip.dataset.length === settings.length);
  }
}

function updateActionState() {
  if (state === "running") {
    actionBtn.disabled = false;
    return;
  }
  const provider = PROVIDERS[providerSelect.value];
  const missingKey = provider.requiresKey && !settings.keys[providerSelect.value];
  const missingBase = providerSelect.value === "custom" && !settings.customBaseUrl;
  actionBtn.disabled = missingKey || missingBase || !getModelValue();
  actionBtn.title = missingKey
    ? "Add an API key in Settings first"
    : missingBase
      ? "Add a base URL in Settings first"
      : "";
}

// --- Events -----------------------------------------------------------------

async function onProviderChange() {
  settings = await saveSettings({ providerId: providerSelect.value });
  syncProviderUI();
}

async function onModelChange() {
  const providerId = providerSelect.value;
  const value = getModelValue();
  if (providerId === "custom") {
    settings = await saveSettings({ customModel: value });
  } else {
    settings = await saveSettings({ models: { ...settings.models, [providerId]: value } });
  }
  updateActionState();
}

async function onLengthClick(event) {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  settings = await saveSettings({ length: chip.dataset.length });
  syncLengthChips();
}

function onAction() {
  if (state === "running") {
    cancel();
    return;
  }
  start();
}

async function onCopy() {
  if (!fullText) return;
  await navigator.clipboard.writeText(fullText);
  const original = copyBtn.textContent;
  copyBtn.textContent = "Copied";
  setTimeout(() => (copyBtn.textContent = original), 1200);
}

// --- Summarize flow ---------------------------------------------------------

function start() {
  fullText = "";
  resultEl.hidden = true;
  resultEl.innerHTML = "";
  emptyState.hidden = true;
  copyBtn.disabled = true;
  setRunning(true);
  setStatus("Reading page…", true);

  port = chrome.runtime.connect({ name: "tldr" });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => {
    if (state === "running") fail("Connection to the extension was closed.");
  });

  port.postMessage({
    type: "summarize",
    providerId: providerSelect.value,
    model: getModelValue(),
    length: settings.length,
    language: settings.language
  });
}

function cancel() {
  try {
    port?.postMessage({ type: "cancel" });
  } catch {
    /* already gone */
  }
  disconnect();
  setRunning(false);
  if (fullText) {
    renderResult(fullText);
    setStatus("Cancelled — showing partial summary.", false);
  } else {
    showEmpty();
    setStatus("Cancelled.", false);
  }
}

function onPortMessage(msg) {
  switch (msg.type) {
    case "progress":
      setStatus(msg.message, true);
      break;
    case "meta":
      pageTitle.textContent = msg.title || "Untitled page";
      pageChars.textContent = `${formatNumber(msg.chars)} chars${msg.truncated ? " (trimmed)" : ""}`;
      pageMeta.hidden = false;
      break;
    case "chunk":
      fullText += msg.text;
      renderResult(fullText);
      statusEl.hidden = true;
      break;
    case "done":
      fullText = msg.text || fullText;
      renderResult(fullText);
      setRunning(false);
      setStatus("", false);
      copyBtn.disabled = false;
      writeCache(fullText);
      disconnect();
      break;
    case "error":
      fail(msg.error);
      break;
  }
}

function fail(message) {
  disconnect();
  setRunning(false);
  setStatus(message, false, true);
  if (!fullText) resultEl.hidden = true;
  else copyBtn.disabled = false;
}

function disconnect() {
  try {
    port?.disconnect();
  } catch {
    /* noop */
  }
  port = null;
}

// --- Rendering --------------------------------------------------------------

function renderResult(text) {
  emptyState.hidden = true;
  statusEl.hidden = true;
  resultEl.hidden = false;
  resultEl.innerHTML = renderMarkdown(text);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function showEmpty() {
  resultEl.hidden = true;
  emptyState.hidden = false;
}

function setStatus(message, spinning, isError = false) {
  if (!message) {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.classList.toggle("error", isError);
  statusEl.innerHTML = "";
  if (spinning) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    statusEl.appendChild(spinner);
  }
  statusEl.appendChild(document.createTextNode(message));
}

function setRunning(running) {
  state = running ? "running" : "idle";
  actionBtn.textContent = running ? "Cancel" : "Summarize page";
  actionBtn.classList.toggle("btn-primary", !running);
  providerSelect.disabled = running;
  if (modelControl) modelControl.disabled = running;
  updateActionState();
}

// Minimal markdown renderer: headings, bullets, bold, inline code.
function renderMarkdown(source) {
  const lines = escapeHtml(source || "").split(/\r?\n/);
  const inline = (t) =>
    t
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }

    closeList();

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }

    html += `<p>${inline(line)}</p>`;
  }

  closeList();
  return html;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// --- Cache (per browser session) -------------------------------------------

function cacheKey() {
  return [
    "tldr-cache",
    currentTabUrl,
    providerSelect.value,
    getModelValue(),
    settings.length,
    settings.language
  ].join("::");
}

async function readCache() {
  try {
    const key = cacheKey();
    const stored = await chrome.storage.session.get(key);
    return stored[key] || null;
  } catch {
    return null;
  }
}

async function writeCache(text) {
  try {
    await chrome.storage.session.set({ [cacheKey()]: text });
  } catch {
    /* session storage unavailable */
  }
}

async function getActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || "";
  } catch {
    return "";
  }
}
