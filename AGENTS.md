# OutreachIt — Agent Instructions

## Project intent

OutreachIt is an open-source, self-hosted outreach manager that anyone should be
able to clone, configure, and run for themselves. Keep it generic across people
and businesses. Email is the first outreach channel.

Planned features include contacts, custom contact fields, templates,
campaigns, scheduling, and sending analytics. These are product direction, not
permission to implement additional features outside the requested task.

The current project implements MongoDB-backed projects, contacts, custom text fields,
CSV imports, templates, campaigns, standalone Compose, scheduling, and SMTP sending with multiple mail accounts.
The initial product is a local internal tool
without authentication; do not introduce accounts or multi-tenancy unless asked.

## Workspace and architecture

- Use pnpm and TypeScript throughout. Keep the single root `pnpm-lock.yaml`.
- `apps/client`: Vite + React UI. Keep browser code and presentation here. Use
  React Router in `router.tsx`, separate layouts and pages, feature components, and
  shadcn/ui primitives in `components/ui/`.
- `apps/server`: Node.js + Express API. Keep database access, credentials, email
  sending, and background jobs on the server. MongoDB is the database. Organize
  Mongoose schemas in `models/`, HTTP handlers in `controllers/`, endpoint wiring in
  `routes/`, reusable workflow logic in `services/`, and middleware/config/migrations
  in their corresponding folders.
- `packages/shared`: contracts, validation, and utilities needed by both apps.
  Keep this package independent of either app and free of server-only secrets
  and dependencies.
- Use ESM and the existing strict TypeScript configuration. Preserve type safety;
  do not use `any`, unchecked casts, or suppression directives to hide errors.
- Follow existing architecture, naming, formatting, and patterns. Prefer simple
  solutions and reuse existing code. Avoid speculative abstractions, unnecessary
  dependencies, and unrelated refactors.

## Open-source and self-hosting requirements

- Never hardcode personal addresses, business categories, domains, credentials,
  absolute machine paths, or provider-specific assumptions into product behavior.
- Configure deployment-specific values through documented environment variables
  or application settings. Supply non-secret examples in `.env.example` files.
- Never commit secrets, real contact data, local environment files, logs, or build
  artifacts. Never expose server credentials to the client or logs.
- Keep setup reproducible using the documented Node.js and pnpm versions. Update
  the README and environment examples when setup or configuration changes.
- Prefer local operation and portable integrations. Do not add required hosted
  services, telemetry, or paid dependencies without an explicit requirement.
- Keep sample data optional and clearly separate from real user data.
- Do not choose a license or add licensing claims without the owner's direction.

## Project scoping

- Home (`/`) is project selection without a sidebar. `/projects/:projectId` opens
  Contacts with the project sidebar; custom fields and project renaming belong to
  `/projects/:projectId/settings`. The sidebar switch/create menu sits below the logo.
  Switching projects preserves the section and resets page state.
- Contacts, custom fields, imports, counts, suppression, and deleted-email reservations
  belong to a required project. Scope every lookup and mutation to its project.
- Emails and custom-field keys are unique within a project. Project names are unique
  ignoring case. Tags are no longer an active feature; startup migration removes
  legacy tags and contact tagIds.
- Run the idempotent project and mail-account migrations before accepting requests
  or starting workers. Stop previous servers/workers before upgrading. Mail accounts
  live in mailaccounts; hourlyLimit, timeZone, and nextSendAt live on Project. Verify
  migrated data before dropping emailsettings and projectemailsettings; fail startup
  on conflicts. Preserve account IDs, ciphertext, campaign references, snapshots,
  queue states, attempts, suppression, and deleted-email reservations. Keep encryption
  keys unchanged. Require an explicit account for campaign saves and test sends.
- Campaigns can use a saved template or store their own subject and HTML message.
  Require exactly one content source. Reuse the same validation, sanitization,
  personalization, and unsubscribe behavior for preview and launch; never create
  a reusable template implicitly for a direct campaign email.
- Standalone Compose lives at `/projects/:projectId/compose`, with drafts and submissions
  in `messages`, never hidden campaigns or implicit templates. Drafts may be incomplete.
  Submission requires an explicit account, confirmed action, valid content, and eligible
  recipients (maximum 10,000 entries). Resolve typed emails only within the project;
  create missing contacts on confirmation without restoring or overwriting existing ones.
  Freeze sender, addresses and personalized content before activation. Campaign and message
  jobs share worker claims, rate reservations, attempts and conservative crash recovery.
  Each job belongs to exactly one source. Run the restart-safe partial recipient-index
  migration before requests/workers, with older processes stopped. Interrupted preparation
  requires explicit retry; unknown SMTP outcomes never automatically resend. Cancellation
  preserves in-flight outcomes, and account removal must respect unfinished messages.
- Legacy unscoped records belong to the stable Default project, even after that project is renamed.
- Use `/api/projects/:projectId/...` for project data. Never add unscoped bypasses.

## Client/server integration

- Use relative `/api` URLs in the client so installations work behind one origin.
- Development currently exposes the client on `127.0.0.1:5173` and proxies `/api`
  to Express on `127.0.0.1:3001`. These are two underlying server ports with one
  browser entry point. Keep the proxy target consistent with the server port.
- Express serves the built client in production when its dist directory exists,
  using one origin for browser routes and API requests.
- Keep the default local bind address unless a requested deployment needs another
  configuration. Validate external input on the server and return useful errors.

## Outreach behavior

- Build generic contact and campaign workflows. Do not assume a particular
  industry, require lead scores, or hardcode recipients or automatic test copies.
- Use explicit user actions for test emails and campaign launches. Never send
  real outreach as part of development checks or seed scripts.
- Keep preview and actual-send personalization consistent. Protect suppressed
  contacts and avoid automatic duplicate sends when adding sending workflows.
- Distinguish SMTP acceptance from confirmed delivery in labels and analytics.
- The existing Wizyz codebase was consulted for architecture and UI inspiration. Do not
  introduce dependencies on that repository, its private data, or local paths.

## Working practices

- Inspect existing code and applicable instructions before changing files.
- Keep changes focused; fix root causes and preserve existing behavior unless the
  task requires a change.
- Preserve user changes. Do not discard files, commit, push, or rewrite Git
  history unless explicitly asked.
- Explore the repository and make routine decisions independently. Ask questions
  only when missing information materially affects the implementation.
- Add meaningful tests when behavior warrants them. Avoid tests that merely
  duplicate implementation details or add overhead to trivial changes.
- Review the final diff for regressions, accidental changes, dead code, and secrets.
- Finish with a brief summary of changes, verification, and any checks that could
  not be completed.

## Commands and verification

Run commands from the repository root:

```sh
pnpm install
docker compose up -d mongodb
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The root development command builds shared contracts first, then watches all
three packages. Recursive builds run in dependency order. For standalone app
commands, build `@outreachit/shared` first if its output is missing.

Run relevant tests and the lint, typecheck, and build checks after code changes.
For documentation-only changes, verify content and whitespace; application checks
are not required. The API integration suite runs against a temporary MongoDB
instance, or a random isolated database at `TEST_MONGODB_URI` when supplied.
Never point tests at user data or drop a non-test database. Do not claim tests
passed when only lint, typecheck, or build was run.

Use a local SMTP capture service or mocks for future email verification.

## Inbox and replies

- Inbox lives at `/projects/:projectId/inbox`; switching projects preserves the
  section and clears account/message selection. Incoming settings and live Inbox
  endpoints belong beneath the project's `/email-accounts/:accountId` path.
- IMAP is optional, explicit, read-only and on demand. Do not infer provider hosts,
  poll mailboxes, modify flags or synchronize folders. Identify mail by account,
  UIDVALIDITY and UID; fetch 50 headers per page and bodies only on selection.
  Bound connections/downloads and source size to 20 MiB. Disable protocol logs,
  sanitize MIME HTML and block remote resources in a sandboxed frame.
- Replies are standalone `messages` with kind `reply` and server-created reply
  context. Existing messages default to `compose`. Never accept kind/context from
  clients. Lock reply account and destination; validate threading headers from the
  source. Replies use literal content, no contacts, personalization, unsubscribe
  footer or outreach suppression. Only validated reply jobs may omit a contact.
- Reuse the shared worker and project rate reservations, submission idempotency,
  cancellation and conservative unknown-outcome handling. Block account removal
  for reply drafts, unfinished submissions and in-flight jobs. No Sent append.
  Verify IMAP with mocks and SMTP with mocks/local capture only.
