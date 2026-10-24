# Administrative API / MCP coverage

MCP runs at `/api/mcp` in Express. All project tools require `projectId`.
The paths below begin with `/api`; `P` means `/projects/:projectId`.
Tools delegate to these REST handlers. Sending and resumption tools require
`confirmed: true` after explicit user approval.

| API operation | MCP tool |
| --- | --- |
| GET /health | `get_health` |
| GET /projects | `list_projects` |
| POST /projects | `create_project` |
| PUT P | `rename_project` |
| GET P/overview | `get_project_overview` |
| GET P/contacts | `list_contacts` |
| POST P/contacts | `create_contact` |
| PUT P/contacts/:id (including suppression) | `update_contact` |
| DELETE P/contacts/:id | `delete_contact` |
| GET P/custom-fields | `list_custom_fields` |
| POST P/custom-fields | `create_custom_field` |
| PUT P/custom-fields/:id | `update_custom_field` |
| DELETE P/custom-fields/:id | `delete_custom_field` |
| POST P/contacts/import/headers | `get_import_headers` |
| POST P/contacts/import/preview | `preview_import` |
| POST P/contacts/import | `import_contacts` |
| GET P/email-accounts | `list_email_accounts` |
| POST P/email-accounts | `create_email_account` |
| PUT P/email-accounts/:accountId | `update_email_account` |
| DELETE P/email-accounts/:accountId | `delete_email_account` |
| POST P/email-accounts/:accountId/verify | `verify_email_account` |
| POST P/email-accounts/:accountId/test | `send_test_email` |
| GET P/sending-settings | `get_sending_settings` |
| PUT P/sending-settings | `update_sending_settings` |
| PUT P/email-accounts/:accountId/incoming | `update_incoming_settings` |
| POST P/email-accounts/:accountId/incoming/verify | `verify_incoming_account` |
| GET P/email-accounts/:accountId/inbox | `list_inbox` |
| GET P/email-accounts/:accountId/inbox/:uidValidity/:uid | `read_inbox_message` |
| POST P/email-accounts/:accountId/inbox/reply | `create_reply` |
| GET P/templates | `list_templates` |
| POST P/templates | `create_template` |
| GET P/templates/:id | `get_template` |
| PUT P/templates/:id | `update_template` |
| DELETE P/templates/:id | `delete_template` |
| POST P/templates/preview | `preview_template` |
| GET P/campaigns | `list_campaigns` |
| POST P/campaigns | `create_campaign` |
| GET P/campaigns/:id | `get_campaign` |
| PUT P/campaigns/:id | `update_campaign` |
| DELETE P/campaigns/:id | `delete_campaign` |
| POST P/campaigns/audience-preview | `preview_campaign_audience` |
| POST P/campaigns/:id/launch | `launch_campaign` |
| POST P/campaigns/:id/pause | `pause_campaign` |
| POST P/campaigns/:id/resume | `resume_campaign` |
| POST P/campaigns/:id/cancel | `cancel_campaign` |
| POST P/campaigns/:id/draft | `draft_campaign` |
| GET P/campaigns/:id/report (JSON) | `get_campaign_report` |
| GET P/campaigns/:id/report?format=csv | `export_campaign_report` |
| GET P/messages | `list_messages` |
| POST P/messages | `create_message` |
| GET P/messages/:id | `get_message` |
| PUT P/messages/:id | `update_message` |
| DELETE P/messages/:id | `delete_message` |
| POST P/messages/preview | `preview_message` |
| POST P/messages/:id/preview | `preview_reply` |
| POST P/messages/:id/submit | `submit_message` |
| POST P/messages/:id/cancel | `cancel_message` |
| POST P/messages/:id/resume | `resume_message` |
| GET P/messages/:id/report | `get_message_report` |

`/unsubscribe/:token` is public and remains outside MCP. Unsupported campaign
or message actions are rejected by the existing handlers, rather than exposed
as tools. Account credentials are write-only tool inputs; results use the shared
password-free account schema. MCP clients can retain submitted arguments.
