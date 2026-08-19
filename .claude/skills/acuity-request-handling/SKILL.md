---
name: acuity-request-handling
description: Use this skill whenever handling a day-to-day Acuity Scheduling request through the acuity-mcp server — listing or checking appointments/availability, creating/rescheduling/cancelling an appointment, or any other live-calendar operation. Load it before making Acuity tool calls or API requests for this project. Triggers on requests like "book an appointment", "check availability", "reschedule this", "cancel this booking", "what's on the calendar", "list appointment types". Not for installing or configuring the server or accounts — see acuity-mcp-setup for that.
---

# Handling Acuity requests

This skill governs how to *use* the Acuity MCP server day to day — booking, checking availability,
rescheduling, cancelling, querying. For first-time setup or account configuration, use the
`acuity-mcp-setup` skill instead.

## Read the local learnings file first

Before handling any Acuity request, check whether `~/.config/acuity-mcp/learnings.md` exists. If
it does, read it before proceeding — it accumulates gotchas, API quirks, and points of confusion
specific to how this particular user/machine actually uses this server (which account is which in
practice, workarounds discovered through trial and error, corrections the user has given before).

That file is deliberately **not** part of this repo and never committed — it's local operational
memory that supports this generic skill without living inside it. If it doesn't exist yet, that's
fine; nothing has been recorded yet.

## When you hit friction, record it

Any time you either (a) get confused mid-task and have to troubleshoot your way to a working
approach, or (b) get corrected or newly informed by the user about something non-obvious in how
Acuity or this server behaves — append an entry to `~/.config/acuity-mcp/learnings.md` (create it
if it doesn't exist yet) before finishing the task. Use this format:

```
## <short title> — <YYYY-MM-DD>
<What went wrong or was confusing, and the concrete trigger for it.>
**Resolution:** <what actually worked, and why — include exact parameter names, endpoints, or
error text so a future session can pattern-match on it.>
```

Keep entries factual and reusable. The point is that a future session hitting the same situation
should skip the confusion entirely by reading this file first, rather than rediscovering the same
answer from scratch.

## General operating rules

- **Mutating calls** (`create_appointment`, `reschedule_appointment`, `cancel_appointment`) change
  a live calendar and can send real emails to real clients. Always confirm the specifics — which
  account, exact date/time, which calendar, client details — with the user before calling one.
  Never assume.
- **A success response doesn't prove a mutation actually took effect as requested.** Re-fetch with
  `get_appointment` after any create/reschedule/cancel and confirm the returned state matches what
  was actually requested before telling the user it worked.
- **Ambiguous relative dates** ("next Wednesday", "this Friday") should be clarified with the user
  rather than assumed — especially when today itself falls on the named weekday.
- **Multi-account setups**: confirm which `account` a call is about to run against before any
  mutating call — run `list_accounts` if unsure what's configured. Never let a mutating request
  fall through to whatever the default account happens to be without confirming that's correct.
- If a request appears to hit a hard restriction (a documented API limitation, a plan-tier gate,
  a validation error), check the official Acuity API docs
  (https://developers.acuityscheduling.com) for a documented, legitimate way around it before
  telling the user it's impossible — and check the local learnings file first, since a prior
  session may have already found and recorded one.
