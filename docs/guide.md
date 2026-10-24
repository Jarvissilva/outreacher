# Outreacher guide

[Back to the README](../README.md)

A self-hosted email outreach manager built with React,
Node.js, SQLite, and TypeScript in a pnpm workspace. The client uses React Router
and shadcn/ui with Tailwind CSS.

## Available now

- Contact creation, editing, deletion, search, pagination, and audience counts.
- Projects with unique names, a Home directory, contact counts, and a project selector.
- Custom text fields with stable keys, editable labels, and contact filtering.
- CSV import with column mapping, preview, row-level errors, and duplicate checks.
- Project-scoped contacts, custom fields, duplicate checks, and do-not-contact suppression.

- Multiple project mail accounts with encrypted SMTP passwords, connection verification and explicit test recipients.
- Rich-text templates, contact personalization, HTML sanitization and plain-text alternatives.
- Standalone Compose with saved drafts, contact and typed recipients, personalized previews, and send history.
- Campaign recipient review, immediate/scheduled launch, sending windows, pause/resume/cancel.
- Persistent sending queue, recipient reports, CSV export and project-scoped unsubscribe links.

SMTP acceptance is reported separately from confirmed delivery (which is not tracked).
Follow-up sequences, attachments, images and open/click tracking are outside this version.

## Requirements

- Node.js 22.13+ (22.x), or Node.js 24+
- pnpm 10.22.0
- A writable local data directory

## Development

```sh
pnpm install
pnpm dev
```

Client: http://127.0.0.1:5173. API: http://127.0.0.1:3001/api/health.
Vite proxies `/api` requests to the server in development.

Open http://127.0.0.1:5173 for both the UI and `/api` requests through Vite's proxy.
The app has no authentication and binds to localhost by default.

Server settings have local defaults. To customize them, copy
`apps/server/.env.example` to `apps/server/.env`:

| Variable        | Default        | Purpose                                                    |
| --------------- | -------------- | ---------------------------------------------------------- |
| `HOST`          | `127.0.0.1`    | API bind address                                           |
| `PORT`          | `3001`         | API port; keep the Vite proxy target in sync               |
| `DATA_DIR`      | `~/.local/share/outreacher` | Directory containing the SQLite database                   |
| `DATABASE_PATH` | unset          | Optional explicit SQLite file path; overrides `DATA_DIR`   |

The default file is `~/.local/share/outreacher/outreacher.sqlite`, independent of
the working directory. Relative `DATA_DIR` and `DATABASE_PATH` overrides resolve
from the working directory (`apps/server` for the documented pnpm commands). The server opens the SQLite
database, applies the schema, and verifies it before accepting requests.
`GET /api/health` returns database readiness; an unavailable or unwritable database
returns 503. The database uses WAL mode, so keep the `.sqlite`, `-wal`, and `-shm`
files together when copying it.

## Working with contacts

Create or select a project from Home, add optional custom fields, then add contacts manually or choose
**Import CSV**. Only email is required; company and other business details are
optional. Imports support UTF-8 CSV with a unique header row, up to 2,000 rows,
100 columns, and a file size of 1 MB.

```csv
email,firstName,lastName,company
alex@example.com,Alex,Taylor,Example
sam@example.com,Sam,River,
```

Map columns to standard or custom fields in the selected project. Preview is
read-only. The confirmed import adds valid new contacts and skips invalid rows
and duplicate emails. Existing contacts are never overwritten. Email matching
ignores case and surrounding whitespace.

Mark a contact **Do not contact** to suppress outreach. Deletion hides a contact
but retains its database record, email reservation, and suppression preference;
reimporting that email will not reactivate it. This version has no restore UI.
Email reservations and suppression apply within each project; the same email can
exist independently in another project. Custom field keys cannot be renamed,
and fields with values on active contacts cannot be deleted until those values
are cleared.

## Workspace

- `apps/client`: React + Vite; `router.tsx` defines React Router routes, `layouts/`
  defines page shells, `pages/` contains route screens, and `components/ui/` contains
  shadcn/ui primitives. Feature components live in their own component folders.
- `apps/server`: Express API; `db/` holds the SQLite schema and repositories,
  `controllers/` holds HTTP handlers, `routes/` maps URLs to controllers,
  `services/` holds reusable workflow logic, and `middleware/` and `config/`
  handle startup and cross-cutting concerns.
- `packages/shared`: shared TypeScript contracts

The root development command builds shared contracts first, then watches the
shared, server and client packages. Build commands run in dependency order.

## MCP integration

MCP starts automatically inside the Express server at `/api/mcp`, using
Streamable HTTP with JSON responses. It shares the application's port, SQLite
database and sending worker. There is no separate package, stdio process,
persistent MCP session or additional worker. Tools reuse the existing REST handlers
for project isolation, validation, sanitization, suppression and queue behavior.

Start Outreacher normally (`pnpm dev`, or build and run `pnpm start`). In an MCP
client that supports Streamable HTTP, configure the server URL:

```json
{
  "mcpServers": {
    "outreacher": {
      "url": "http://127.0.0.1:3001/api/mcp"
    }
  }
}
```

Use `http://127.0.0.1:6004/api/mcp` for the production deployment below. Client
configuration syntax varies; choose Streamable HTTP rather than legacy SSE.
POST carries protocol requests; GET and DELETE return 405. The internal REST URL
is generated from `HOST` and `PORT`, using loopback for wildcard binds.
`OUTREACHER_API_URL` is no longer used.

MCP validates the request Host and any supplied Origin. Defaults allow only
`localhost`, `127.0.0.1` and `[::1]` on the configured server port, with their HTTP
origins. For a private reverse proxy, add exact comma-separated Host authorities
(hostname and port when nonstandard) and browser Origin values to the server's
environment, for example:

```dotenv
MCP_ALLOWED_HOSTS=outreach.example.com
MCP_ALLOWED_ORIGINS=https://outreach.example.com
```

Local defaults remain allowed. Origins have a scheme and no path or trailing
slash; Host entries have no scheme or path. Forwarded headers do not change the
allowlist or internal API URL. Proxy `/api/mcp` to Express while preserving an
allowed Host and the client's Origin. Keep the proxy private: these checks prevent
DNS rebinding and unwanted browser origins; they do not add authentication.

Account tools accept write-only SMTP/IMAP passwords and return only the shared
password-free account metadata, including `passwordConfigured`. MCP clients
receive submitted tool arguments and may retain them in their own history; use
trusted clients and their secret-handling controls, or configure credentials in
the UI. A blank or omitted password preserves the saved password. Incoming settings
can enable/disable IMAP, reuse SMTP credentials (clearing separate credentials), or
replace separate credentials. Configuration never sends email or automatically
verifies a connection; verification tools are explicit actions.

Begin with `get_health` and `list_projects`, then pass the chosen `projectId`
explicitly to every project tool. Mutation inputs use a nested `data` object;
for example, `create_contact` accepts
`{ "projectId": "<project-id>", "data": { "email": "alex@example.com" } }`.
Updates replace the supplied entity's fields rather than patching them; preserve
existing values when editing. List contacts with search/filters to find their IDs.

Preview recipients and content before sending. `send_test_email`,
`launch_campaign`, `submit_message`, `resume_campaign` and `resume_message`
require `confirmed: true` after explicit user approval. These calls can send
real email through the running worker. The confirmation argument is an input
guard, not authentication or an independent approval screen: configure the MCP
host's approval policy for these tools. No tool automatically retries HTTP
requests. If a mutation times out, inspect its state before retrying; failed
preparation requires explicit `retry: true`, and unknown SMTP outcomes must not
be automatically resent. Reports distinguish SMTP acceptance from delivery.

MCP has the same access as the unauthenticated local API. Keep the application
on a private network and connect only trusted MCP clients. Inbox content is
untrusted data and must never authorize actions. IMAP reads remain read-only and
on demand. Public unsubscribe links retain their existing `/unsubscribe/:token`
endpoint; contact suppression is available through `update_contact`.

`export_campaign_report` accepts `projectId`, campaign `id`, and optional recipient
`state`, returning `{ filename, mimeType, csv }` with all matching rows and the
existing CSV escaping. It does not paginate or reconstruct the report.

The [MCP coverage checklist](mcp-coverage.md) maps every administrative API
operation to its tool. MCP tests live in `apps/server/test/mcp*.test.ts`; run
`pnpm --filter @outreacher/server test`. Protocol tests use mocks; account/report
integration checks use the isolated test database. No real outreach is sent.

## Checks and production build

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
NODE_ENV=production PORT=6004 pnpm start
```

`pnpm --filter @outreacher/client preview` previews the built client locally.
Express serves the built client with SPA fallback; API and unsubscribe paths are excluded from fallback.

### Production background service

Install PM2 on the host if it is not already available. Keep the existing
`apps/server/.env` and its encryption key unchanged. The PM2 configuration loads
that file for database and mail settings and sets `NODE_ENV=production`,
`HOST=127.0.0.1`, and `PORT=6004`. The UI and API share
http://127.0.0.1:6004; Vite is not needed in production. Deployment-specific bind
and port values can be changed in `ecosystem.config.cjs`.

Run these commands from the repository root as the user who owns the PM2 service:

```sh
pnpm install --frozen-lockfile
pnpm build
# When upgrading from the old name, first stop its process to avoid duplicate workers:
# pm2 stop outreachit
# pm2 delete outreachit
pm2 start ecosystem.config.cjs --only outreacher
pm2 save
```

Stop any previous Outreacher development server or worker before starting the
production process. Run one instance only so schema setup and sending workers do
not overlap. Existing database files and credentials are reused.

```sh
pm2 status outreacher
pm2 logs outreacher --lines 50
curl --fail http://127.0.0.1:6004/api/health
```

For updates, stop Outreacher before installing/building, then start it again:

```sh
pm2 stop outreacher
pnpm install --frozen-lockfile
pnpm build
pm2 restart ecosystem.config.cjs --only outreacher --update-env
pm2 save
```

Use `pm2 stop outreacher` to stop the service. To restore saved processes after
a reboot, configure PM2's startup service once using `pm2 startup` and follow its
printed instructions. Reuse an existing enabled PM2 startup service when present.
Keep the app bound to localhost for internal use; it has no authentication.

Client tests use Vitest and Testing Library to exercise project navigation,
sidebar creation, Settings, redirects, and state reset. API integration tests use
isolated temporary SQLite files created for each test process. They never use the
application database or real contact data.

```sh
pnpm test
```

## API foundation

All routes are under `/api`. Request schemas and response contracts live in
`packages/shared`. Failed requests return `{ error: { message, details? } }`.

- `GET /health`
- `GET/POST /projects`, `PUT /projects/:id` (rename)
- `GET /projects/:projectId/overview`
- `GET/POST /projects/:projectId/contacts`, `PUT/DELETE /projects/:projectId/contacts/:id`
- `POST /projects/:projectId/contacts/import/headers`
- `POST /projects/:projectId/contacts/import/preview`
- `POST /projects/:projectId/contacts/import`
- `GET/POST /projects/:projectId/custom-fields`, `PUT/DELETE /projects/:projectId/custom-fields/:id`

Contacts accept `page`, `limit`, `search`, `status` (`all`, `active`, or
`suppressed`), and `fieldKey`/`fieldValue` query parameters. Custom-field filtering
matches a case-insensitive substring. Emails and custom-field keys are unique
within a project. Project names are unique ignoring case and surrounding whitespace.
Unscoped data APIs are unavailable.

## Projects and existing data

Home (`/`) is a standalone project selection page without a sidebar. Opening a
project uses `/projects/:projectId`, where Contacts is the default screen. The
project sidebar has a switch/create menu below the logo and navigation to Contacts
Compose, Templates, Campaigns, and Settings. `/projects/:projectId/settings` contains project renaming, SMTP settings, and custom
fields. The selector preserves the current section when switching projects and
resets filters, pagination, and dialogs. New projects open immediately after creation.
Project deletion is not supported. Previous project `/contacts` and `/fields` URLs
redirect to the project root and Settings respectively.

## Database

Existing installations can keep their current SQLite file by setting `DATABASE_PATH`
to its absolute path before restarting. Files are not moved or renamed automatically;
keep the existing encryption key unchanged.

Outreacher stores projects, contacts, custom fields, mail accounts, templates,
campaigns, standalone messages, recipient jobs, and attempts in one SQLite file.
The file is created automatically on first start at
`~/.local/share/outreacher/outreacher.sqlite`, or under `DATA_DIR` (or at
`DATABASE_PATH`). The current schema starts fresh at version 1; there is no importer
from the earlier MongoDB version, and old MongoDB data is left untouched.

The database uses foreign keys, WAL journaling, partial unique indexes, and a
single-process worker. Keep one API process per database file. The project-scoped
email/key uniqueness constraints, deleted-email reservations, suppression,
recipient-job ownership, atomic claims, and rate reservations are enforced by the
database and repositories.

Keep `EMAIL_ENCRYPTION_KEY` stable across restarts and back it up separately from
the database. Losing or changing the key prevents decryption of saved SMTP and IMAP
passwords. Do not commit the database, `-wal`, or `-shm` files.

## Email workflow

Configure Settings → Mail accounts for each project. Add as many SMTP accounts as needed, giving each a name. TLS modes are implicit TLS,
required STARTTLS (default), or unencrypted SMTP for a local capture service.
Certificate verification stays enabled. Optional authentication uses an encrypted
password; a blank replacement preserves it. Save the account before using **Verify connection**
(no message) or **Send test email** (requires a recipient).

Set `EMAIL_ENCRYPTION_KEY` to 32 cryptographically random bytes encoded as 64 hex
characters. Generate it with the command in `apps/server/.env.example`. Optionally set
`PUBLIC_UNSUBSCRIBE_BASE_URL` to the externally accessible origin for unsubscribe
links, for example `https://mail.example.com`. Both are server-only. Preview, template
tests, campaign launches and Compose sends work when this URL is unset or blank.
Configured URLs must use HTTP(S) without credentials, query strings or fragments;
invalid configured URLs are rejected. Campaign launch requires sender settings.
The browser suggests its IANA time zone when first configuring a project.

Create a template with the rich-text toolbar. Placeholders include standard contact
fields (`{{firstName}}`, `{{email}}`, etc.), `{{custom.field_key}}`, and
`{{unsubscribeUrl}}`. Unknown placeholders are rejected. Preview a contact to see
missing-value warnings. Save before sending a template test. When the public URL is
configured, an unsubscribe link is appended when one is not included. Without it,
no unsubscribe footer or unsubscribe headers are generated, and `{{unsubscribeUrl}}`
becomes empty with a preview warning. Existing saved jobs retain their frozen
content and unsubscribe headers, and existing signed links continue working as
long as the encryption key is unchanged. Contact suppression still applies;
reply behavior is unchanged. Preview, test, campaign and Compose messages share the
server renderer. Link URLs allow HTTP, HTTPS and mailto; images and executable
content are removed.

Create a campaign, choose a mail account, and write its subject and rich-text email
directly or use a saved template. Direct campaign emails are stored with the campaign
and do not create reusable templates. Choose all, selected, or filtered contacts, then
review recipients and explicitly confirm launch or schedule. The contact picker supports
search, pagination, selecting the current page, and clearing the selection. Scheduling
and sending windows are available in an expandable section. Scheduling uses the
browser's local date/time, converted to UTC; weekday/hour windows use the project's
saved IANA time zone. Daylight-saving changes follow that zone. Windows currently
stay within one day (start hour must precede end hour). Empty weekdays/hours mean
unrestricted sending. A project defaults to 60 messages/hour, shared across all its accounts, campaigns, and standalone messages. Set the limit and time zone under Project sending settings.

Launch freezes the selected account ID, recipient addresses, personalized content and sender identity. The worker always uses that account; it never falls back to a different account.
Later template edits do not affect an existing launch. Only drafts are editable.
Scheduled campaigns can return to draft before sending starts. Active campaigns
can pause/resume/cancel. Already begun SMTP submissions may finish after a control
change. Failed preparations require an explicit retry and cannot send partial work.

## Standalone Compose

Open **Compose** in a project (`/projects/:projectId/compose`) to send separate
personalized emails without creating a campaign. Select saved contacts using search,
enter addresses separated by commas or newlines, and choose an explicit mail account.
Optionally copy a template into the subject and rich-text body; later template edits
do not change the draft. **Save draft** is explicit and accepts incomplete content.
Use **Drafts** to reopen it or **Send history** to inspect submitted messages.

**Preview** renders current content on the server without creating contacts or sending.
**Review and send** shows the sender, deduplicated eligible count and exclusions before
**Confirm send**. Up to 10,000 recipient entries are supported. Email matching ignores
case and whitespace. Suppressed and deleted contacts stay excluded; confirmation creates
only missing contacts and never restores or overwrites existing ones. Missing personalized
values are shown as preview warnings. Each eligible recipient receives a separate email.
Regular Compose messages do not support scheduling, CC/BCC, or attachments.
Inbox replies open in Compose with their original account and destination locked.

Submission freezes sender identity, account ID, recipient addresses, personalized content
and unsubscribe links before making any jobs sendable. Work starts immediately through
the existing worker and shares the project's hourly budget with campaigns. History shows
per-recipient queued, SMTP accepted, failed, skipped and outcome unknown states and attempt
history. Correct account settings and explicitly resume a paused submission. Cancellation
skips unsubmitted work; in-flight SMTP submissions can still finish. Repeating submission
for the same draft returns the existing submission. Interrupted preparations stay unsendable
until an explicit retry. Ambiguous SMTP outcomes never resend automatically.

Drafts and submissions live in the `messages` table; no hidden campaigns or reusable
templates are created. All message APIs use `/api/projects/:projectId/messages`:
GET/POST the collection, GET/PUT/DELETE `/:id` (edit/delete only drafts), POST `/preview`,
POST `/:id/submit` with `{ "confirmed": true }` (add `"retry": true` only for failed
preparation), GET `/:id/report?page=1`, and POST `/:id/cancel` or `/:id/resume`.
Accounts with unfinished submissions or in-flight jobs cannot be removed.

Recipient jobs enforce exactly one owning campaign or message, and partial unique
indexes prevent duplicate campaign/contact and message/contact recipients while
allowing null contacts for validated replies. Schema setup runs before HTTP requests
and worker activity. Back up `messages` together with campaigns, recipient jobs,
contacts, accounts, projects, and the unchanged encryption key.

## Worker and reports

The Express process runs a persistent SQLite-backed scheduler once per second. Keep the
server running for scheduled sends; overdue campaigns resume on restart. Atomic job
claims have renewable 90-second leases. Unsubmitted abandoned claims are requeued;
interrupted submissions become **Outcome unknown** and are never automatically
resent. Review those outcomes with your SMTP provider manually. Definite SMTP 4xx
rejections retry with exponential backoff, for at most three retries after the initial submission.
Authentication/connection configuration failures pause campaigns and standalone messages using the affected account; save
corrected account settings and explicitly resume. Other accounts can continue sending. Permanent rejections remain failed.

Project rate limits are enforced by atomic reservation and spacing between messages.
The worker rechecks contact project, suppression, deletion, and destination email
before submission. Changed destinations are skipped. Reports include attempts and
redacted reasons; filters and CSV export are available on campaign details. Queued,
sending, SMTP accepted, failed, skipped and outcome unknown are distinct states.
No provider bounce processing, confirmed-delivery metric or open/click tracking is
implemented. Suppression applies only to one project. Unsubscribe GET shows a
confirmation form; POST applies suppression idempotently, including standard
one-click unsubscribe requests.

## Production and private administration

Build and run locally with `pnpm build` then `pnpm --filter @outreacher/server start`.
The API serves the built client on the configured host and port. Set
`EMAIL_ENCRYPTION_KEY` in `apps/server/.env` or your shell. Optionally set
`PUBLIC_UNSUBSCRIBE_BASE_URL` to enable unsubscribe links and headers.
SQLite data stays in `~/.local/share/outreacher` unless overridden.

There are no accounts. Keep administration behind a private network/VPN or an
authenticated reverse proxy. A public unsubscribe hostname must proxy **only**
`GET/POST /unsubscribe/*` to Express and deny every other path. For example, an nginx
public server block can use:

```nginx
location /unsubscribe/ {
    limit_except GET POST { deny all; }
    proxy_pass http://127.0.0.1:3001;
}
location / { return 404; }
```

Use HTTPS on the public hostname. Serve administration through a separate private
host or tunnel. Do not publish `/api`, SPA assets, or the administration port to the
public internet. Signed unsubscribe links contain scoped identifiers, so avoid
logging full unsubscribe paths at your reverse proxy. In development, open
unsubscribe URLs directly on the configured Express origin (Vite proxies `/api`).

Back up the SQLite database to access-controlled storage. Stop the app before a
file copy, or use SQLite's online backup command, and include the `-wal` and `-shm`
files when copying manually. Back up the encryption key separately and preserve the
public unsubscribe URL; losing or changing the key prevents password decryption and
invalidates existing links. Restore into an isolated location before switching
production. Never run a restored queue alongside its source: submitted messages
cannot be recalled or deduplicated across independent databases. After restore,
expired submitting leases become outcome unknown; do not blindly requeue them.
Verify application health before resuming.

Accounts used by preparing, scheduled, active, or paused campaigns cannot be
removed; cancel those campaigns or return scheduled campaigns to draft first.
Removing an account clears its saved password and keeps its historical identity.
Drafts referencing a removed account must select another account before launch.

Email APIs are project-scoped: `/email-accounts` (GET/POST),
`/email-accounts/:accountId` (PUT/DELETE), `/email-accounts/:accountId/verify`,
`/email-accounts/:accountId/test` (POST), and `/sending-settings` (GET/PUT).
Campaign inputs require `emailAccountId`. The UI asks for an explicit choice,
including template test sends. Other APIs include `/templates` (GET/POST),
`/templates/:id` (GET/PUT/DELETE), `/templates/preview` (POST), `/campaigns`
(GET/POST), `/campaigns/:id` (GET/PUT/DELETE), `/campaigns/audience-preview`,
`/campaigns/:id/launch`, `/campaigns/:id/{pause,resume,cancel,draft}` (POST), and
`/campaigns/:id/report` (GET; `state`, `page`, `format=csv`). Prefix each with
`/api/projects/:projectId`. Public `/unsubscribe/:token` is separate.

Email tests use mocked SMTP submission and a loopback SMTP capture server only.
They never send real outreach.

### Inbox and replies

Each project has an **Inbox**. In Settings → Mail accounts → Incoming mail
(IMAP), enable incoming mail and enter your provider's host, port and TLS mode.
Use implicit TLS (usually port 993) or required STARTTLS as documented by your
provider. Server addresses are never inferred. Incoming mail defaults to the saved
SMTP credentials; separate IMAP credentials can be saved instead. Passwords are
encrypted with the same `EMAIL_ENCRYPTION_KEY`; keep that key unchanged across
upgrades. Blank separate-password replacements preserve the saved value. Switching
back to SMTP credentials clears the separate saved password. Save settings, then
select **Verify incoming connection**. Verification does not send email, and incoming
connection errors do not pause SMTP sending.

Choose an account in Inbox, then Refresh to fetch live mail. Only INBOX is supported:
50 headers per page, newest first, with bodies downloaded only when opened. Reading
uses read-only IMAP access and leaves read status unchanged. Message identity includes
the account, UIDVALIDITY and UID; refresh if the mailbox changes. Source messages are
limited to 20 MiB. Received HTML is sanitized and sandboxed; images, scripts, embedded
content and remote resources are blocked. Mail is not synchronized or polled in the
background. The server needs network access to the configured IMAP and SMTP servers.

**Reply** creates a saved draft in Compose. Its account and single destination are
fixed to the source account and Reply-To (or From). The original context is displayed
separately; the reply starts empty. Reply text is literal, including any `{{braces}}`:
no contact is created, no personalization or unsubscribe footer is added, and outreach
suppression checks do not apply. Review shows the sender and destination before
confirmation. Valid Message-ID and References preserve threading; messages without a
valid Message-ID can still receive unthreaded replies. Replies appear in Drafts and
Send history and share the project sending limit, durable worker, cancellation and
conservative retry rules. Unknown SMTP outcomes never resend automatically. Delete
reply drafts or cancel unfinished submissions before removing their account.

Stop older processes before upgrading and complete schema setup before restarting
workers. This version does not include folder browsing,
read-status changes, Reply all, forwarding, attachments, OAuth or Sent-folder sync;
replies are not appended to the provider's Sent folder. Use mocks or a local mail
capture service for tests, never real outreach.
