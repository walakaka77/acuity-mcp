import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const API_BASE = "https://acuityscheduling.com/api/v1";
export const CONFIG_DIR = join(homedir(), ".config", "acuity-mcp");
export const ACCOUNTS_FILE = join(CONFIG_DIR, "accounts.json");
const LEGACY_CREDENTIALS_FILE = join(CONFIG_DIR, "credentials");

function loadAccountsFile() {
  try {
    const data = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    if (!data || typeof data !== "object" || typeof data.accounts !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

function loadLegacyCredentialsFile() {
  let raw;
  try {
    raw = readFileSync(LEGACY_CREDENTIALS_FILE, "utf8");
  } catch {
    return null;
  }
  const values = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  if (!values.ACUITY_USER_ID || !values.ACUITY_API_KEY) return null;
  return { userId: values.ACUITY_USER_ID, apiKey: values.ACUITY_API_KEY };
}

/**
 * Resolution order:
 * 1. ACUITY_USER_ID + ACUITY_API_KEY env vars — direct override, no file needed.
 * 2. `account` argument, or ACUITY_ACCOUNT env var — looked up by name in accounts.json.
 * 3. accounts.json's own "default" account.
 * 4. accounts.json with exactly one account configured — used automatically.
 * 5. Legacy flat `~/.config/acuity-mcp/credentials` file (single-account, pre-multi-account format).
 */
export function resolveCredentials(account) {
  if (process.env.ACUITY_USER_ID && process.env.ACUITY_API_KEY) {
    return { userId: process.env.ACUITY_USER_ID, apiKey: process.env.ACUITY_API_KEY, accountName: null, source: "env" };
  }

  const data = loadAccountsFile();
  const requestedName = account || process.env.ACUITY_ACCOUNT;

  if (data) {
    const names = Object.keys(data.accounts);

    if (requestedName) {
      const acc = data.accounts[requestedName];
      if (!acc) {
        throw new Error(
          `No configured Acuity account named "${requestedName}". Available: ${names.length ? names.join(", ") : "(none configured)"}.` +
            ` Add one with: node bin/acuity-accounts.js add ${requestedName} --user-id <id> --api-key <key>`
        );
      }
      return { userId: acc.userId, apiKey: acc.apiKey, accountName: requestedName, source: "accounts-file" };
    }

    if (data.default && data.accounts[data.default]) {
      return {
        userId: data.accounts[data.default].userId,
        apiKey: data.accounts[data.default].apiKey,
        accountName: data.default,
        source: "accounts-file-default",
      };
    }

    if (names.length === 1) {
      const only = names[0];
      return { userId: data.accounts[only].userId, apiKey: data.accounts[only].apiKey, accountName: only, source: "accounts-file-only" };
    }

    if (names.length > 1) {
      throw new Error(
        `Multiple Acuity accounts are configured (${names.join(", ")}) but none is set as default and none was ` +
          `specified for this call. Pass {"account": "<name>"} to the tool call, set the ACUITY_ACCOUNT env var, ` +
          `or run: node bin/acuity-accounts.js set-default <name>`
      );
    }
  }

  const legacy = loadLegacyCredentialsFile();
  if (legacy) {
    return { userId: legacy.userId, apiKey: legacy.apiKey, accountName: null, source: "legacy-file" };
  }

  throw new Error(
    "No Acuity credentials configured. Run `node bin/acuity-accounts.js add <name> --user-id <id> --api-key <key>`, " +
      "or set ACUITY_USER_ID/ACUITY_API_KEY env vars. See README.md."
  );
}

export function listAccounts() {
  const data = loadAccountsFile();
  if (!data) return { default: null, accounts: [] };
  return {
    default: data.default || null,
    accounts: Object.entries(data.accounts).map(([name, acc]) => ({
      name,
      userId: acc.userId,
      label: acc.label || null,
      isDefault: name === data.default,
    })),
  };
}

function buildUrl(path, query) {
  const url = new URL(API_BASE + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function acuityRequest(method, path, { query, body, account } = {}) {
  const { userId, apiKey } = resolveCredentials(account);
  const url = buildUrl(path, query);
  const auth = Buffer.from(`${userId}:${apiKey}`).toString("base64");

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Acuity API auth failed (401) — check the User ID / API Key for this account.");
    }
    if (response.status === 429) {
      throw new Error("Acuity API rate limit hit (429) — retry after a short delay.");
    }
    const message =
      (data && typeof data === "object" && (data.message || data.error)) || text || response.statusText;
    throw new Error(`Acuity API error ${response.status}: ${message}`);
  }

  return data;
}
