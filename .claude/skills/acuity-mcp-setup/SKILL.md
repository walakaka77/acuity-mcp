---
name: acuity-mcp-setup
description: Use this skill whenever a user wants to set up, configure, or manage this Acuity Scheduling MCP server — first-time setup, adding a new Acuity account/credential set, registering the server with Claude Code, switching between multiple configured accounts, listing what's configured, or troubleshooting a connection/auth error. Triggers on requests like "set up Acuity", "add my Acuity credentials", "configure this for a new account", "add another Acuity account", "switch to my sandbox account", "test the Acuity connection", "this repo isn't working".
---

# Acuity MCP setup

This repo is a local MCP server that exposes the Acuity Scheduling API as Claude Code tools. It
supports multiple Acuity accounts at once. Your job when this skill is invoked: get the user from
"just downloaded this" to "working, verified tool calls" with minimal friction, and get any
additional accounts added cleanly later.

**Never ask the user to paste secrets into a place that ends up committed or logged somewhere
persistent beyond their own machine.** Credentials always end up in
`~/.config/acuity-mcp/accounts.json` (outside this repo, chmod `600`), never in this repo, never
in `~/.claude.json` if it can be avoided (prefer the `account` argument / accounts file over
passing raw `-e ACUITY_API_KEY=...` at registration time).

## First-time setup

1. **Check dependencies are installed**: does `node_modules/` exist? If not, run `npm install` in
   this repo's root first.
2. **Ask the user for their Acuity User ID and API Key**, if not already given. Tell them where to
   find it if they don't know: Acuity dashboard → **Business Settings → Integrations → API**.
3. **Ask for a short account name/label** (e.g. `production`, `sandbox`, `personal`) — lowercase,
   no spaces, since it's used as both a JSON key and a CLI argument. If this is clearly the only
   account they'll ever need, you can default to `default` or `production` without belaboring the
   question, but still confirm before writing anything.
4. **Save it**, non-interactively so you don't have to deal with a live prompt:
   ```bash
   node bin/acuity-accounts.js add <name> --user-id <id> --api-key <key> [--label "human description"]
   ```
   The first account added becomes the default automatically.
5. **Register the MCP server with Claude Code**, if not already registered:
   ```bash
   claude mcp add acuity -s user -- node "<absolute path to this repo>/server.js"
   ```
   Note there's deliberately no `-e ACUITY_USER_ID=...` here — credentials come from the accounts
   file, not from the registration command, so nothing secret ends up sitting in `~/.claude.json`.
6. **Verify before declaring success** — don't just say "done," actually check:
   ```bash
   node bin/acuity-accounts.js test <name>
   ```
   This should print `OK — <name>: <email>, plan "...", N calendar slot(s).` If it errors, see
   [Troubleshooting](#troubleshooting) below.
7. Tell the user to start a new Claude Code session, or run `/mcp` in the current one, for the
   `acuity` server's tools to actually appear in that session's tool list — this is a Claude Code
   requirement, not specific to this server.

## Adding another account (multi-account)

Same as step 2–4 of first-time setup, just with a new name — nothing about the existing
account(s) or the MCP server registration needs to change:

```bash
node bin/acuity-accounts.js add <new-name> --user-id <id> --api-key <key> --label "..."
```

Confirm it with `node bin/acuity-accounts.js test <new-name>`.

Ask the user whether this new account should become the default
(`node bin/acuity-accounts.js set-default <new-name>`) — don't silently change the default without
asking, since that changes behavior for every tool call that doesn't explicitly specify `account`.

## Switching between accounts

Two ways, and the user may want either depending on what they're doing:

- **Per-call, within one session** (no re-registration needed): pass `account: "<name>"` as an
  argument to any Acuity tool. E.g. "check appointment types for the sandbox account" → call
  `list_appointment_types` with `{"account": "sandbox"}`. This is the right default suggestion for
  most requests to "switch accounts" — it's immediate and doesn't touch any config.
- **Change the default for everything**: `node bin/acuity-accounts.js set-default <name>` — use
  this only when the user means "make this the one I use going forward," not just "check this one
  account right now."

Run `list_accounts` (an MCP tool, no shell needed) or `node bin/acuity-accounts.js list` to show
the user what's configured and which is currently default. Never print raw API keys back into
chat — both of these deliberately only expose names/labels/User IDs.

## Troubleshooting

- **`Acuity API auth failed (401)`** — bad User ID or API Key for that account. Re-check the
  values in the Acuity dashboard and re-add: `node bin/acuity-accounts.js add <name> --user-id
  <id> --api-key <key>` (re-adding an existing name overwrites it).
- **`403: API access is only available on Powerhouse plans`** — not a bug, not fixable from this
  repo. Acuity gates API access by plan tier; Basic Auth succeeded (that's why it's `403` not
  `401`) but Acuity itself is rejecting the request. Tell the user this plainly: they'd need to
  upgrade that Acuity account's plan, or use a different path to the same account (e.g. a Zapier
  Acuity connector, which has empirically not hit this same restriction) if they need one right
  now. Don't spend time debugging further — this has been confirmed multiple times as a hard
  account-level gate, not a code issue.
- **No error, but a mutating call's result looks unchanged** — see the README's "Lessons learned"
  section. Always re-fetch with `get_appointment` after a `create_appointment` /
  `reschedule_appointment` / `cancel_appointment` call before telling the user it worked. This
  server had a real bug once (`reschedule_appointment` hitting the wrong endpoint, silently
  no-op'ing with a `200`) that only surfaced this way.
- **Testing a credential pair that isn't the account currently in use, and getting a confusing
  result** — don't use `ACUITY_USER_ID=x ACUITY_API_KEY=y npx @modelcontextprotocol/inspector
  --cli ...` to test it; that wrapper doesn't reliably forward ad-hoc env vars to the spawned
  server process and can silently fall back to old credentials, giving a false result. Use
  `node bin/acuity-accounts.js test <name>` instead.
- **Tools don't show up in a Claude session at all** — newly-registered MCP servers only load at
  session start. Run `/mcp`, or start a new session.

## Mutating calls need confirmation

`create_appointment`, `reschedule_appointment`, and `cancel_appointment` make real changes to a
live calendar and can send real emails to real clients. Always confirm with the user before
calling one of these — which account, what time, what client details — the same way you would for
any other consequential, hard-to-reverse action. This applies doubly when multiple accounts are
configured: double-check which `account` you're about to act on before a mutating call, since
booking/cancelling against the wrong account is exactly the kind of mistake multi-account support
makes newly possible.
