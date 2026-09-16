// Shared settings helpers. API keys live in chrome.storage.local, which is
// sandboxed per-extension and never synced to Google's servers.

import { PROVIDERS, getProvider } from "./providers.js";

export const DEFAULT_SETTINGS = {
  providerId: "anthropic",
  models: {},
  keys: {},
  customBaseUrl: "",
  customModel: "",
  language: "English",
  length: "tldr",
  maxInputChars: 24000,
  temperature: 0.2,
  autoSummarize: false
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function resolveModel(settings, providerId) {
  if (providerId === "custom") return settings.customModel || "";
  return settings.models[providerId] || getProvider(providerId)?.defaultModel || "";
}

export function resolveBaseUrl(settings, providerId) {
  if (providerId === "custom") return settings.customBaseUrl || "";
  return getProvider(providerId)?.baseUrl || "";
}

export function resolveKey(settings, providerId) {
  return settings.keys[providerId] || "";
}

// Returns a list of { id, label, configured } for the popup's provider picker.
export function configuredProviders(settings) {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    configured: !p.requiresKey || Boolean(settings.keys[id])
  }));
}
