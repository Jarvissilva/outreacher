<div align="center">

# Outreacher

**Self-hosted email outreach, in one workspace.**

Manage contacts, write emails, run campaigns, and read replies. Your data stays on your machine.

[Get started](#get-started) · [Highlights](#highlights) · [Your first email](#your-first-email) · [Documentation](#documentation)

</div>

Outreacher is a local-first email outreach manager built with React, Node.js, SQLite, and TypeScript. Connect your own mail accounts and organize your work into projects.

## Highlights

| Feature | What you can do |
| --- | --- |
| **Projects & contacts** | Keep separate contact lists, import CSV files, and add custom fields. |
| **Mail accounts** | Connect multiple SMTP accounts and optionally enable read-only IMAP. |
| **Compose & templates** | Save drafts, reuse templates, and personalize each recipient's email. |
| **Campaigns** | Review recipients, send now or schedule, and control sending limits. |
| **Inbox & replies** | Read incoming mail on demand and reply from the same account. |
| **Reports** | Inspect sending results and export campaign reports as CSV. |
| **MCP** | Manage your workspace from an MCP client through the built-in server. |

Sending reports show **SMTP acceptance**, not confirmed delivery. Attachments, follow-up sequences, and open/click tracking are not supported.

## Get started

Requires **Node.js 22.13+ (22.x) or 24+** and **pnpm 10.22.0**.

From your source checkout:

```sh
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env
pnpm dev
```

Open **http://127.0.0.1:5173**. If you already have `apps/server/.env`, keep it instead of copying over it.

You can explore contacts and projects immediately. Before configuring mail accounts or sending outreach, add the email settings described below.

Outreacher has **no authentication**. It binds to localhost by default; keep administration private or behind an authenticated reverse proxy.

## Your first email

1. Create a project from Home.
2. Add contacts manually or import a CSV file.
3. Open **Settings** and add a mail account with your SMTP details.
4. Use **Verify connection**, then send a test email to an address you choose.
5. Open **Compose**, choose the account and recipients, and write your email.
6. Preview it, review the recipients, and confirm the send.

Use **Templates** for reusable content and **Campaigns** for scheduled outreach. Enable IMAP in an account's incoming settings to read mail and reply from **Inbox**.

## Email settings

Edit `apps/server/.env`:

```dotenv
EMAIL_ENCRYPTION_KEY=your_generated_key
# Optional: enable unsubscribe links and headers
PUBLIC_UNSUBSCRIBE_BASE_URL=
```

Generate an encryption key once:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the result into `EMAIL_ENCRYPTION_KEY`. Keep this key unchanged and back it up separately: saved SMTP and IMAP passwords depend on it.

`PUBLIC_UNSUBSCRIBE_BASE_URL` is optional. Set it to a public HTTP(S) origin such as `https://mail.example.com` to enable outreach unsubscribe links and headers. Leave it unset or blank to preview and send without a generated unsubscribe footer or headers; `{{unsubscribeUrl}}` becomes empty and previews warn when it is used. Contact suppression still applies. When enabled, configure your reverse proxy to expose only `/unsubscribe/*` there, while keeping the app private. See the [deployment guide](docs/guide.md#production-and-private-administration).

## Data storage

SQLite data is created automatically outside the repository:

```text
~/.local/share/outreacher/outreacher.sqlite
```

Set `DATA_DIR` to use another directory, or `DATABASE_PATH` to use a specific SQLite file. `DATABASE_PATH` takes precedence. Existing files are not moved automatically.

Stop the app before copying the database and its `-wal` / `-shm` files. Keep the encryption key with your backups, stored separately from the database. See [backup and restore guidance](docs/guide.md#production-and-private-administration).

## Documentation

<details>
<summary><strong>Run in production</strong></summary>

Build and start the app:

```sh
pnpm build
NODE_ENV=production pnpm start
```

Open **http://127.0.0.1:3001**. Express serves both the UI and API; Vite is only needed for development.

For a background service, install PM2 and use the included configuration:

```sh
pm2 start ecosystem.config.cjs --only outreacher
pm2 save
```

The included PM2 configuration uses **http://127.0.0.1:6004**. Stop any previous development server or worker before starting production. Run one API process per database.

See [production setup and updates](docs/guide.md#production-background-service) for the full workflow.

</details>

<details>
<summary><strong>Connect an MCP client</strong></summary>

MCP starts with the app. Add this to a client that supports Streamable HTTP:

```json
{
  "mcpServers": {
    "outreacher": {
      "url": "http://127.0.0.1:3001/api/mcp"
    }
  }
}
```

Use port `6004` with the included PM2 setup. Connect only trusted clients; MCP has the same access as the local app. Sending tools require explicit confirmation.

See [MCP configuration](docs/guide.md#mcp-integration) and the [tool coverage checklist](docs/mcp-coverage.md).

</details>

<details>
<summary><strong>Development</strong></summary>

| Directory | Purpose |
| --- | --- |
| `apps/client` | React UI, Vite, React Router, and shadcn/ui. |
| `apps/server` | Express API, SQLite, mail integrations, and sending worker. |
| `packages/shared` | Shared TypeScript contracts and validation. |

```sh
pnpm dev        # Start the client and API with file watching
pnpm test       # Run server and client tests
pnpm lint
pnpm typecheck
pnpm build
```

Development uses port `5173` for the UI and proxies `/api` to port `3001`. Tests use temporary databases and mocks or local SMTP capture; they do not send real outreach.

</details>

For contact imports, personalization, sending behavior, API details, and deployment settings, read the [full guide](docs/guide.md).
