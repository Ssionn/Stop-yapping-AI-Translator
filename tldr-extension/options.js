import { PROVIDERS, getProvider } from "./lib/providers.js";
import { loadSettings, saveSettings } from "./lib/settings.js";

let settings = null;

init();

async function init() {
  settings = await loadSettings();
  renderDefaults();
  renderProviders();
  renderCustom();
  wireReset();
}

// --- Defaults ---------------------------------------------------------------

function renderDefaults() {
  document.getElementById("language").value = settings.language;
  document.getElementById("length").value = settings.length;
  document.getElementById("maxInputChars").value = settings.maxInputChars;
  document.getElementById("temperature").value = settings.temperature;
  document.getElementById("autoSummarize").checked = Boolean(settings.autoSummarize);

  const saveText = debounce((key, value) => patch({ [key]: value }), 500);

  document.getElementById("language").addEventListener("input", (e) => {
    saveText("language", e.target.value.trim() || "English");
  });
  document.getElementById("length").addEventListener("change", (e) =>
    patch({ length: e.target.value })
  );
  document.getElementById("maxInputChars").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    if (Number.isFinite(value) && value >= 2000) saveText("maxInputChars", Math.min(value, 120000));
  });
  document.getElementById("temperature").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    if (Number.isFinite(value) && value >= 0 && value <= 1) saveText("temperature", value);
  });
  document.getElementById("autoSummarize").addEventListener("change", (e) =>
    patch({ autoSummarize: e.target.checked })
  );
}

// --- Provider cards ---------------------------------------------------------

function renderProviders() {
  const container = document.getElementById("providers");

  for (const [id, provider] of Object.entries(PROVIDERS)) {
    if (id === "custom") continue;

    const models = [...provider.models];
    const selected = settings.models[id] || provider.defaultModel;
    if (selected && !models.includes(selected)) models.unshift(selected);

    const modelControl = provider.editableModels
      ? `<input type="text" data-role="model" value="${escapeAttr(selected)}" placeholder="${escapeAttr(
          provider.defaultModel || "model name"
        )}" autocomplete="off" spellcheck="false" />`
      : `<select data-role="model">
           ${models.map((m) => `<option value="${escapeAttr(m)}">${escapeAttr(m)}</option>`).join("")}
         </select>`;

    const card = document.createElement("section");
    card.className = "card provider";
    card.dataset.id = id;

    const hasKey = Boolean(settings.keys[id]);
    const keyBlock = provider.requiresKey
      ? `
        <div class="row">
          <div class="field">
            <label>API key</label>
            <div class="key-wrap">
              <input type="password" data-role="key" placeholder="Paste your key"
                value="${escapeAttr(settings.keys[id] || "")}" autocomplete="off" spellcheck="false" />
              <button class="btn btn-ghost" data-role="reveal" type="button">Show</button>
            </div>
          </div>
        </div>`
      : `
        <div class="row">
          <button class="btn" data-role="grant" type="button">Grant access to ${escapeAttr(
            new URL(provider.baseUrl).host
          )}</button>
        </div>`;

    card.innerHTML = `
      <div class="card-head">
        <h2>${provider.label}</h2>
        <span class="badge ${hasKey || !provider.requiresKey ? "ok" : "missing"}" data-role="badge">
          ${hasKey || !provider.requiresKey ? "Ready" : "No key"}
        </span>
      </div>
      ${keyBlock}
      <div class="row">
        <div class="field">
          <label>Model</label>
          ${modelControl}
        </div>
        <button class="btn" data-role="test" type="button">Test</button>
      </div>
      <p class="test-result" data-role="result" hidden></p>
      ${provider.keyUrl ? `<p class="hint"><a href="${provider.keyUrl}" target="_blank" rel="noreferrer">Get an API key</a></p>` : ""}
    `;

    const modelInput = card.querySelector('[data-role="model"]');
    if (!provider.editableModels) modelInput.value = selected;

    modelInput.addEventListener("change", (e) => {
      const modelsMap = { ...settings.models, [id]: e.target.value.trim() };
      patch({ models: modelsMap });
    });

    if (provider.requiresKey) {
      const keyInput = card.querySelector('[data-role="key"]');
      const badge = card.querySelector('[data-role="badge"]');
      const saveKey = debounce(() => {
        const keys = { ...settings.keys, [id]: keyInput.value.trim() };
        patch({ keys }).then(() => updateBadge(badge, Boolean(keys[id])));
      }, 400);

      keyInput.addEventListener("input", saveKey);
      keyInput.addEventListener("blur", () => {
        const keys = { ...settings.keys, [id]: keyInput.value.trim() };
        patch({ keys }).then(() => updateBadge(badge, Boolean(keys[id])));
      });

      card.querySelector('[data-role="reveal"]').addEventListener("click", (e) => {
        const isPassword = keyInput.type === "password";
        keyInput.type = isPassword ? "text" : "password";
        e.target.textContent = isPassword ? "Hide" : "Show";
      });
    } else {
      card.querySelector('[data-role="grant"]').addEventListener("click", (e) =>
        grantOrigin(provider.baseUrl, e.target)
      );
    }

    const result = card.querySelector('[data-role="result"]');
    card.querySelector('[data-role="test"]').addEventListener("click", () => {
      runTest({
        providerId: id,
        apiKey: card.querySelector('[data-role="key"]')?.value.trim() || "",
        model: modelInput.value.trim(),
        baseUrl: provider.baseUrl,
        resultEl: result
      });
    });

    container.appendChild(card);
  }
}

function updateBadge(badge, ready) {
  if (!badge) return;
  badge.textContent = ready ? "Ready" : "No key";
  badge.classList.toggle("ok", ready);
  badge.classList.toggle("missing", !ready);
}

// --- Custom provider --------------------------------------------------------

function renderCustom() {
  const baseUrlInput = document.getElementById("customBaseUrl");
  const modelInput = document.getElementById("customModel");
  const keyInput = document.getElementById("customKey");
  const result = document.getElementById("custom-result");

  baseUrlInput.value = settings.customBaseUrl || "";
  modelInput.value = settings.customModel || "";
  keyInput.value = settings.keys.custom || "";

  document.getElementById("custom-save").addEventListener("click", async () => {
    const raw = baseUrlInput.value.trim();
    if (!raw) {
      showResult(result, "error", "Enter a base URL.");
      return;
    }

    let origin;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad scheme");
      origin = url.origin;
    } catch {
      showResult(result, "error", "That doesn't look like a valid URL.");
      return;
    }

    const granted = await requestOriginPermission(origin);
    if (!granted) {
      showResult(result, "error", `Access to ${origin} was not granted.`);
      return;
    }

    const keys = { ...settings.keys, custom: keyInput.value.trim() };
    await patch({
      customBaseUrl: raw.replace(/\/+$/, ""),
      customModel: modelInput.value.trim(),
      keys,
      providerId: "custom"
    });
    baseUrlInput.value = settings.customBaseUrl;
    showResult(result, "ok", "Saved. Access granted.");
  });

  document.getElementById("custom-test").addEventListener("click", () => {
    runTest({
      providerId: "custom",
      apiKey: keyInput.value.trim(),
      model: modelInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      resultEl: result
    });
  });
}

// --- Shared helpers ---------------------------------------------------------

async function runTest({ providerId, apiKey, model, baseUrl, resultEl }) {
  resultEl.hidden = false;
  resultEl.className = "test-result";
  resultEl.textContent = "Testing…";

  if (!model) {
    showResult(resultEl, "error", "Choose a model first.");
    return;
  }
  if (providerId === "custom" && baseUrl) {
    try {
      await requestOriginPermission(new URL(baseUrl).origin);
    } catch {
      /* validated on the raw call below */
    }
  }

  try {
    const res = await chrome.runtime.sendMessage({ type: "testKey", providerId, apiKey, model, baseUrl });
    if (res?.ok) showResult(resultEl, "ok", `Works — model replied: “${res.reply}”`);
    else showResult(resultEl, "error", res?.error || "Test failed.");
  } catch (err) {
    showResult(resultEl, "error", err?.message || "Test failed.");
  }
}

function showResult(el, kind, message) {
  el.hidden = false;
  el.className = `test-result ${kind}`;
  el.textContent = message;
}

async function grantOrigin(baseUrl, button) {
  try {
    const origin = new URL(baseUrl).origin;
    const granted = await requestOriginPermission(origin);
    showResult(findResultEl(button), granted ? "ok" : "error", granted ? "Access granted." : "Access denied.");
  } catch (err) {
    showResult(findResultEl(button), "error", err.message);
  }
}

function findResultEl(button) {
  return button.closest(".card").querySelector('[data-role="result"]');
}

async function requestOriginPermission(origin) {
  const pattern = `${origin}/*`;
  const has = await chrome.permissions.contains({ origins: [pattern] });
  if (has) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function patch(values) {
  settings = await saveSettings(values);
  return settings;
}

// Debounced per first argument, so editing two fields in quick succession
// does not cancel the first field's pending save.
function debounce(fn, wait) {
  const timers = new Map();
  return (...args) => {
    const key = args[0] ?? "__default__";
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => fn(...args), wait));
  };
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function wireReset() {
  document.getElementById("reset").addEventListener("click", async () => {
    if (!confirm("Delete all API keys and settings for this extension?")) return;
    await chrome.storage.local.clear();
    location.reload();
  });
}
