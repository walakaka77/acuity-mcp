#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CONFIG_DIR, ACCOUNTS_FILE, acuityRequest } from "../lib/acuity-client.js";

function loadFile() {
  try {
    const data = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    if (!data.accounts) data.accounts = {};
    return data;
  } catch {
    return { default: null, accounts: {} };
  }
}

function saveFile(data) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(ACCOUNTS_FILE, 0o600);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function cmdAdd(args) {
  const { flags, positional } = parseFlags(args);
  let name = positional[0];
  if (!name) name = await prompt("Account name (short, e.g. production, sandbox): ");
  if (!name) {
    console.error("Account name is required.");
    process.exit(1);
  }

  let userId = flags["user-id"];
  if (!userId) userId = await prompt("Acuity User ID: ");
  let apiKey = flags["api-key"];
  if (!apiKey) apiKey = await prompt("Acuity API Key: ");
  if (!userId || !apiKey) {
    console.error("Both User ID and API Key are required.");
    process.exit(1);
  }
  const label = typeof flags.label === "string" ? flags.label : undefined;

  const data = loadFile();
  const isFirst = Object.keys(data.accounts).length === 0;
  data.accounts[name] = { userId, apiKey, ...(label ? { label } : {}) };
  if (flags.default || isFirst) data.default = name;
  saveFile(data);

  const defaultNote = data.default === name ? " (set as default)" : "";
  console.log(`Saved account "${name}" to ${ACCOUNTS_FILE}${defaultNote}.`);
}

function cmdList() {
  const data = loadFile();
  const names = Object.keys(data.accounts);
  if (!names.length) {
    console.log("No accounts configured yet. Run: node bin/acuity-accounts.js add <name>");
    return;
  }
  for (const name of names) {
    const acc = data.accounts[name];
    const marker = name === data.default ? " (default)" : "";
    const label = acc.label ? ` — ${acc.label}` : "";
    console.log(`- ${name}${marker} — User ID ${acc.userId}${label}`);
  }
}

function cmdRemove(args) {
  const { positional } = parseFlags(args);
  const name = positional[0];
  const data = loadFile();
  if (!name || !data.accounts[name]) {
    console.error(`No such account: ${name || "(none given)"}. Configured: ${Object.keys(data.accounts).join(", ") || "(none)"}`);
    process.exit(1);
  }
  delete data.accounts[name];
  if (data.default === name) data.default = null;
  saveFile(data);
  console.log(`Removed account "${name}".`);
}

function cmdSetDefault(args) {
  const { positional } = parseFlags(args);
  const name = positional[0];
  const data = loadFile();
  if (!name || !data.accounts[name]) {
    console.error(`No such account: ${name || "(none given)"}. Configured: ${Object.keys(data.accounts).join(", ") || "(none)"}`);
    process.exit(1);
  }
  data.default = name;
  saveFile(data);
  console.log(`Default account set to "${name}".`);
}

async function cmdTest(args) {
  const { positional } = parseFlags(args);
  const name = positional[0];
  try {
    const me = await acuityRequest("GET", "/me", name ? { account: name } : {});
    console.log(`OK — ${name || "(default account)"}: ${me.email}, plan "${me.plan}", ${me.calendarLimit ?? "?"} calendar slot(s).`);
  } catch (error) {
    console.error(`FAILED — ${name || "(default account)"}: ${error.message}`);
    process.exit(1);
  }
}

function cmdPath() {
  console.log(ACCOUNTS_FILE);
}

function usage() {
  console.log(`Usage: acuity-accounts.js <command> [args]

Commands:
  add [name] [--user-id <id>] [--api-key <key>] [--label "..."] [--default]
      Add or update a named account. Prompts interactively for any missing value.
      First account added becomes the default automatically.
  list
      List configured account names, User IDs, and labels (never prints API keys).
  remove <name>
      Remove a configured account.
  set-default <name>
      Change which account is used when no account is specified.
  test [name]
      Call GET /me to verify a named account's credentials actually work.
      Omit <name> to test the default/env-resolved account.
  path
      Print the path to the accounts file.
`);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "add":
    await cmdAdd(rest);
    break;
  case "list":
    cmdList();
    break;
  case "remove":
    cmdRemove(rest);
    break;
  case "set-default":
    cmdSetDefault(rest);
    break;
  case "test":
    await cmdTest(rest);
    break;
  case "path":
    cmdPath();
    break;
  default:
    usage();
    process.exit(cmd ? 1 : 0);
}
