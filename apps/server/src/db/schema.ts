import type { DB } from './database.js';

const schemaV1 = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL UNIQUE,
  hourlyLimit INTEGER NOT NULL DEFAULT 60,
  timeZone TEXT NOT NULL DEFAULT 'UTC',
  nextSendAt TEXT NOT NULL,
  isDefault INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX projects_default ON projects(isDefault) WHERE isDefault = 1;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  email TEXT NOT NULL,
  firstName TEXT NOT NULL DEFAULT '',
  lastName TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  customFields TEXT NOT NULL DEFAULT '{}',
  suppressed INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0, 1)),
  deletedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (projectId, email)
);
CREATE INDEX contacts_project_created ON contacts(projectId, deletedAt, createdAt DESC, id DESC);

CREATE TABLE custom_fields (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  "key" TEXT NOT NULL,
  label TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (projectId, "key")
);

CREATE TABLE mail_accounts (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  archivedAt TEXT,
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 587,
  tlsMode TEXT NOT NULL DEFAULT 'starttls',
  username TEXT NOT NULL DEFAULT '',
  passwordEncrypted TEXT NOT NULL DEFAULT '',
  senderName TEXT NOT NULL DEFAULT '',
  senderEmail TEXT NOT NULL DEFAULT '',
  replyTo TEXT NOT NULL DEFAULT '',
  incoming TEXT,
  sendingError TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX mail_accounts_project ON mail_accounts(projectId, archivedAt);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX templates_project ON templates(projectId);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  templateId TEXT,
  message TEXT,
  emailAccountId TEXT,
  audience TEXT NOT NULL,
  scheduledAt TEXT,
  weekdays TEXT NOT NULL DEFAULT '[]',
  startHour INTEGER,
  endHour INTEGER,
  state TEXT NOT NULL DEFAULT 'draft',
  error TEXT NOT NULL DEFAULT '',
  timeZone TEXT NOT NULL DEFAULT 'UTC',
  senderName TEXT NOT NULL DEFAULT '',
  senderEmail TEXT NOT NULL DEFAULT '',
  replyTo TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  preparationToken TEXT,
  preparationUntil TEXT,
  startedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX campaigns_project_state ON campaigns(projectId, state);
CREATE INDEX campaigns_scheduled ON campaigns(state, scheduledAt);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL DEFAULT 'compose' CHECK (kind IN ('compose', 'reply')),
  replyContext TEXT,
  name TEXT NOT NULL DEFAULT '',
  templateId TEXT,
  message TEXT,
  emailAccountId TEXT,
  audience TEXT NOT NULL,
  scheduledAt TEXT,
  weekdays TEXT NOT NULL DEFAULT '[]',
  startHour INTEGER,
  endHour INTEGER,
  state TEXT NOT NULL DEFAULT 'draft',
  error TEXT NOT NULL DEFAULT '',
  timeZone TEXT NOT NULL DEFAULT 'UTC',
  senderName TEXT NOT NULL DEFAULT '',
  senderEmail TEXT NOT NULL DEFAULT '',
  replyTo TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  preparationToken TEXT,
  preparationUntil TEXT,
  startedAt TEXT,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  contactIds TEXT NOT NULL DEFAULT '[]',
  addresses TEXT NOT NULL DEFAULT '[]',
  excluded INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX messages_project_state_created ON messages(projectId, state, createdAt DESC);

CREATE TABLE recipient_jobs (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  campaignId TEXT,
  messageId TEXT,
  contactId TEXT,
  inReplyTo TEXT NOT NULL DEFAULT '',
  referencesJson TEXT NOT NULL DEFAULT '[]',
  preparationToken TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  unsubscribeUrl TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'queued',
  reason TEXT NOT NULL DEFAULT '',
  availableAt TEXT NOT NULL,
  leaseUntil TEXT,
  leaseToken TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK ((campaignId IS NOT NULL) + (messageId IS NOT NULL) = 1)
);
CREATE UNIQUE INDEX campaign_recipient ON recipient_jobs(campaignId, contactId) WHERE campaignId IS NOT NULL;
CREATE UNIQUE INDEX message_recipient ON recipient_jobs(messageId, contactId) WHERE messageId IS NOT NULL;
CREATE INDEX jobs_campaign_due ON recipient_jobs(projectId, campaignId, state, availableAt);
CREATE INDEX jobs_message_due ON recipient_jobs(projectId, messageId, state, availableAt);
CREATE INDEX jobs_state_lease ON recipient_jobs(state, leaseUntil);
CREATE INDEX jobs_state_due ON recipient_jobs(state, availableAt);

CREATE TABLE recipient_job_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId TEXT NOT NULL REFERENCES recipient_jobs(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX attempts_job ON recipient_job_attempts(jobId, id);
`;

export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM migrations WHERE version = 1').get()) return;
    db.exec(schemaV1);
    db.prepare('INSERT INTO migrations (version) VALUES (1)').run();
  }).immediate();
}
