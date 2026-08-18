# acuity-mcp

A local MCP server exposing the [Acuity Scheduling API](https://developers.acuityscheduling.com/)
as Claude Code tools — list/create/reschedule/cancel appointments, check availability, list
appointment types, calendars, and clients, all directly from a Claude session. Supports **multiple
Acuity accounts** side by side, switchable per tool call.

Built custom because no maintained free MCP for Acuity exists — the only GitHub repo found during
research pointed at an npm package that was never published. Uses `@modelcontextprotocol/sdk` +
`zod`, runs over stdio.

## If you're Claude: read this first

If a user asks you to set this up, add an Acuity account, switch accounts, or troubleshoot a
connection, load **`.claude/skills/acuity-mcp-setup/SKILL.md`** in this repo — it has the full
step-by-step for all of that. This README is the human-facing reference; the skill is what you
should actually follow.

## What you need before setup

An **Acuity Scheduling User ID** and **API Key**, from Acuity: **Business Settings → Integrations
→ API**. One pair per Acuity account you want to connect.

⚠️ **Acuity gates API access by plan tier.** Some plans return `403: API access is only available
on Powerhouse plans` for every request — this is Acuity rejecting your account, not a bug here.
Basic Auth succeeding (no `401`) but every call still `403`-ing is the signature of this. If you
hit it, either upgrade the plan, or use an alternative path to the same account (e.g. a Zapier
Acuity connector, which has empirically not been subject to the same restriction).

## Install

```bash
npm install
```

## Quick start — one account

```bash
node bin/acuity-accounts.js add production --user-id <your-user-id> --api-key <your-api-key>
```

The first account you add automatically becomes the default. Then register the server with
Claude Code:

```bash
claude mcp add acuity -s user -- node "$(pwd)/server.js"
```

Start a new Claude Code session (or run `/mcp` in an existing one) so the tools show up.

Verify it works without a Claude session at all:

```bash
node bin/acuity-accounts.js test
```

## Multiple accounts

Add as many named accounts as you want:

```bash
node bin/acuity-accounts.js add production --user-id 1111111 --api-key aaaa... --label "Real account"
node bin/acuity-accounts.js add sandbox    --user-id 2222222 --api-key bbbb... --label "Trial/test account"
```

Credentials live in `~/.config/acuity-mcp/accounts.json` (chmod `600`, never inside this repo,
never committed). Manage them:

```bash
node bin/acuity-accounts.js list                # see configured accounts (never prints API keys)
node bin/acuity-accounts.js set-default sandbox # change which one is used by default
node bin/acuity-accounts.js remove sandbox      # remove one
node bin/acuity-accounts.js test sandbox        # verify one specific account's credentials
```

**Switching accounts inside a Claude session** doesn't require re-registering anything — every
tool this server exposes accepts an optional `account` argument:

> "List appointment types for the sandbox account" → Claude calls `list_appointment_types` with
> `{"account": "sandbox"}`.

Ask Claude to run `list_accounts` at any time to see what's configured and which is default.

If you'd rather run fully separate MCP server registrations per account instead (e.g. so each
shows up as a distinctly-named server), that still works — point `ACUITY_ACCOUNT` at a name
instead of passing `account` per call:

```bash
claude mcp add acuity-production -s user -e ACUITY_ACCOUNT=production -- node "$(pwd)/server.js"
claude mcp add acuity-sandbox    -s user -e ACUITY_ACCOUNT=sandbox    -- node "$(pwd)/server.js"
```

### Credential resolution order

1. `ACUITY_USER_ID` + `ACUITY_API_KEY` env vars (direct override, no accounts file needed)
2. `account` argument on a tool call, or the `ACUITY_ACCOUNT` env var — looked up by name
3. `accounts.json`'s own `default` account
4. `accounts.json` with exactly one account configured — used automatically
5. Legacy flat `~/.config/acuity-mcp/credentials` file (`ACUITY_USER_ID=...`/`ACUITY_API_KEY=...`
   lines) — supported for backward compatibility with older single-account setups

## Tools

Local only, no Acuity API call:
- `list_accounts` — list configured account names/labels and the default (never API keys)

Read-only:
- `list_appointment_types` — list bookable consult types
- `list_calendars` — list calendars/staff
- `list_appointments` — filterable by date range / calendar / type / canceled status
- `get_appointment` — full detail on one appointment by ID
- `check_availability_dates` — available dates in a month for an appointment type
- `check_availability_times` — available time slots on a date for an appointment type
- `list_clients` — clients who have booked appointments

Mutating (real changes to the live calendar — Claude will ask for confirmation before calling
these):
- `create_appointment` — book a new appointment
- `reschedule_appointment` — change an appointment's date/time
- `cancel_appointment` — cancel an appointment

All tools accept an optional `account` argument (see [Multiple accounts](#multiple-accounts)).

Not implemented (same pattern, add later if needed): payments, blocks, forms, webhooks, gift
certificates.

## Lessons learned (read before extending this server)

- **A `200 OK` from a mutating call does not prove the mutation happened.** `reschedule_appointment`
  originally called `PUT /appointments/:id`, which returned `200` and echoed back the *unchanged*
  appointment — Acuity silently ignored the `datetime` field on that endpoint. The fix was the
  dedicated `PUT /appointments/:id/reschedule` route, matching the pattern `cancel_appointment`
  already used (`/appointments/:id/cancel`). Always re-fetch with `get_appointment` after a write
  before trusting it, especially for any new mutating tool added later.
- **`npx @modelcontextprotocol/inspector --cli` does not reliably forward ad-hoc env vars** to the
  `node server.js` process it spawns. If you're testing credentials that aren't already the
  resolved default (e.g. `ACUITY_USER_ID=x ACUITY_API_KEY=y npx @modelcontextprotocol/inspector
  --cli ...`), it can silently fall back to whatever's already configured and give a false
  positive/negative. Use `node bin/acuity-accounts.js test <name>` instead — built specifically to
  avoid this trap. The inspector CLI remains fine for its original purpose: testing the resolved
  default credentials, or `--method tools/list` to check tool schemas.

## Manual verification

```bash
node bin/acuity-accounts.js test            # tests the default/env-resolved account
node bin/acuity-accounts.js test <name>     # tests one specific named account
npx @modelcontextprotocol/inspector --cli node server.js --method tools/list   # confirms the server starts and tools register correctly
```
