# OutreachIt — Agent Instructions

## Project intent

OutreachIt is an open-source, self-hosted outreach manager that anyone should be
able to clone, configure, and run for themselves. Keep it generic across people
and businesses. Email is the first outreach channel.

Planned features include contacts, custom contact fields, tags, templates,
campaigns, scheduling, and sending analytics. These are product direction, not
permission to implement additional features outside the requested task.

The current project is a minimal scaffold. MongoDB integration and outreach
features have not been implemented. The initial product is a local internal tool
without authentication; do not introduce accounts or multi-tenancy unless asked.

## Workspace and architecture

- Use pnpm and TypeScript throughout. Keep the single root `pnpm-lock.yaml`.
- `apps/client`: Vite + React UI. Keep browser code and presentation here.
- `apps/server`: Node.js + Express API. Keep database access, credentials, email
  sending, and background jobs on the server. MongoDB is the planned database.
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

## Client/server integration

- Use relative `/api` URLs in the client so installations work behind one origin.
- Development currently exposes the client on `127.0.0.1:5173` and proxies `/api`
  to Express on `127.0.0.1:3001`. These are two underlying server ports with one
  browser entry point. Keep the proxy target consistent with the server port.
- Production serving of the built client through Express is not implemented.
  Do not describe it as existing behavior. Prefer a single public origin when
  implementing production hosting.
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
- The existing Wizyz manager was consulted for workflow inspiration only. Do not
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
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

The root development command builds shared contracts first, then watches all
three packages. Recursive builds run in dependency order. For standalone app
commands, build `@outreachit/shared` first if its output is missing.

Run relevant tests and the lint, typecheck, and build checks after code changes.
For documentation-only changes, verify content and whitespace; application checks
are not required. There is currently no automated test suite or root test script;
do not claim tests passed when only lint, typecheck, or build was run.

Use a local SMTP capture service or mocks for future email verification.
