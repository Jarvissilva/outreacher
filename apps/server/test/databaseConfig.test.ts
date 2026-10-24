import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, it } from 'node:test';
import { closeDatabase, connectDatabase, databasePath } from '../src/config/database.js';

let directory: string;
let previousDataDir: string | undefined;
let previousDatabasePath: string | undefined;

beforeEach(() => {
  previousDataDir = process.env.DATA_DIR;
  previousDatabasePath = process.env.DATABASE_PATH;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_PATH;
  directory = mkdtempSync(join(tmpdir(), 'outreacher-config-'));
});

afterEach(() => {
  closeDatabase();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousDatabasePath;
  rmSync(directory, { recursive: true, force: true });
});

it('defaults to the user home data directory without opening a database', () => {
  assert.equal(databasePath(), join(homedir(), '.local', 'share', 'outreacher', 'outreacher.sqlite'));
});

it('creates a configured data directory and initializes SQLite', () => {
  process.env.DATA_DIR = join(directory, 'nested', 'data');
  const expected = join(process.env.DATA_DIR, 'outreacher.sqlite');
  assert.equal(databasePath(), expected);
  connectDatabase();
  assert.ok(existsSync(expected));
});

it('gives an explicit database path precedence and preserves its filename', () => {
  process.env.DATA_DIR = join(directory, 'unused');
  process.env.DATABASE_PATH = join(directory, 'existing-name.sqlite');
  assert.equal(databasePath(), process.env.DATABASE_PATH);
  connectDatabase();
  assert.ok(existsSync(process.env.DATABASE_PATH));
  assert.equal(existsSync(process.env.DATA_DIR), false);
});

it('resolves relative overrides from the working directory', () => {
  process.env.DATA_DIR = 'custom-data';
  assert.equal(databasePath(), resolve('custom-data', 'outreacher.sqlite'));
  process.env.DATABASE_PATH = 'custom-data/legacy.sqlite';
  assert.equal(databasePath(), resolve('custom-data/legacy.sqlite'));
});
