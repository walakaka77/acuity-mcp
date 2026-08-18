import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { acuityRequest, listAccounts } from "./lib/acuity-client.js";

const server = new McpServer({ name: "acuity-mcp", version: "2.0.0" });

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error) {
  return { content: [{ type: "text", text: error.message || String(error) }], isError: true };
}

function tool(name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return ok(await handler(args));
    } catch (error) {
      return fail(error);
    }
  });
}

const ACCOUNT_FIELD = {
  account: z
    .string()
    .optional()
    .describe(
      "Named Acuity account to use for this call (see list_accounts for what's configured). " +
        "Defaults to the accounts file's default account, the ACUITY_ACCOUNT env var, or the " +
        "only configured account if there's just one."
    ),
};

function accountTool(name, config, handler) {
  tool(name, { ...config, inputSchema: { ...config.inputSchema, ...ACCOUNT_FIELD } }, handler);
}

// ---- Account management (local only, no Acuity API call) ----

tool(
  "list_accounts",
  {
    title: "List configured Acuity accounts",
    description:
      "List the named Acuity account credential sets configured locally (names/labels only — " +
      "never the API keys), and which one is the default. Use this to see what's available " +
      "before passing an `account` argument to another tool.",
    inputSchema: {},
  },
  () => listAccounts()
);

// ---- Read-only tools ----

accountTool(
  "list_appointment_types",
  {
    title: "List appointment types",
    description: "List all bookable Acuity appointment types (consult types).",
    inputSchema: {},
  },
  ({ account }) => acuityRequest("GET", "/appointment-types", { account })
);

accountTool(
  "list_calendars",
  {
    title: "List calendars",
    description: "List all calendars (staff/trainers) on the Acuity account.",
    inputSchema: {},
  },
  ({ account }) => acuityRequest("GET", "/calendars", { account })
);

accountTool(
  "list_appointments",
  {
    title: "List appointments",
    description: "List appointments, optionally filtered by date range, calendar, type, or cancellation status.",
    inputSchema: {
      minDate: z.string().optional().describe("Earliest date, YYYY-MM-DD"),
      maxDate: z.string().optional().describe("Latest date, YYYY-MM-DD"),
      calendarID: z.number().int().optional(),
      appointmentTypeID: z.number().int().optional(),
      canceled: z.boolean().optional().describe("true to list only canceled appointments"),
      email: z.string().optional().describe("Filter to appointments booked by this client email"),
      max: z.number().int().optional().describe("Max results to return"),
    },
  },
  ({ account, ...query }) => acuityRequest("GET", "/appointments", { query, account })
);

accountTool(
  "get_appointment",
  {
    title: "Get appointment",
    description: "Get full details for one appointment by ID, including client info and form fields.",
    inputSchema: { id: z.number().int().describe("Appointment ID") },
  },
  ({ id, account }) => acuityRequest("GET", `/appointments/${id}`, { account })
);

accountTool(
  "check_availability_dates",
  {
    title: "Check availability (dates)",
    description: "List available dates in a given month for an appointment type.",
    inputSchema: {
      appointmentTypeID: z.number().int(),
      month: z.string().describe("YYYY-MM"),
      calendarID: z.number().int().optional(),
      timezone: z.string().optional(),
    },
  },
  ({ account, ...query }) => acuityRequest("GET", "/availability/dates", { query, account })
);

accountTool(
  "check_availability_times",
  {
    title: "Check availability (times)",
    description: "List available time slots on a given date for an appointment type.",
    inputSchema: {
      appointmentTypeID: z.number().int(),
      date: z.string().describe("YYYY-MM-DD"),
      calendarID: z.number().int().optional(),
      timezone: z.string().optional(),
    },
  },
  ({ account, ...query }) => acuityRequest("GET", "/availability/times", { query, account })
);

accountTool(
  "list_clients",
  {
    title: "List clients",
    description: "List clients who have booked appointments on this Acuity account.",
    inputSchema: {},
  },
  ({ account }) => acuityRequest("GET", "/clients", { account })
);

// ---- Mutating tools — these change the live calendar ----

accountTool(
  "create_appointment",
  {
    title: "Create appointment",
    description:
      "Book a new appointment on the live Acuity calendar. This sends real confirmation emails to the client unless the account is configured otherwise — confirm with the user before calling.",
    inputSchema: {
      appointmentTypeID: z.number().int(),
      datetime: z.string().describe("ISO 8601 datetime, e.g. 2026-08-10T14:00:00+08:00"),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string().optional(),
      calendarID: z.number().int().optional(),
      notes: z.string().optional(),
      timezone: z.string().optional(),
    },
  },
  ({ account, ...body }) => acuityRequest("POST", "/appointments", { body, account })
);

accountTool(
  "reschedule_appointment",
  {
    title: "Reschedule appointment",
    description:
      "Change an existing appointment's date/time on the live calendar. Confirm with the user before calling. " +
      "Always verify the result with get_appointment afterward — a 200 response does not guarantee the datetime " +
      "actually changed (see README's 'lessons learned' section).",
    inputSchema: {
      id: z.number().int(),
      datetime: z.string().describe("ISO 8601 datetime"),
      calendarID: z.number().int().optional(),
    },
  },
  ({ id, account, ...body }) => acuityRequest("PUT", `/appointments/${id}/reschedule`, { body, account })
);

accountTool(
  "cancel_appointment",
  {
    title: "Cancel appointment",
    description: "Cancel an appointment on the live calendar. Confirm with the user before calling.",
    inputSchema: {
      id: z.number().int(),
      cancelNote: z.string().optional(),
      noEmail: z.boolean().optional().describe("true to suppress the cancellation email to the client"),
    },
  },
  ({ id, account, ...body }) => acuityRequest("PUT", `/appointments/${id}/cancel`, { body, account })
);

const transport = new StdioServerTransport();
await server.connect(transport);
