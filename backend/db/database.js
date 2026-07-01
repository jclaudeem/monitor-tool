const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../monitor.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      location   TEXT,
      api_key    TEXT NOT NULL UNIQUE,
      last_seen  DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      ip_address  TEXT NOT NULL UNIQUE,
      type        TEXT NOT NULL DEFAULT 'device',
      location    TEXT,
      agent_id    INTEGER REFERENCES agents(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS poll_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id     INTEGER NOT NULL,
      status        TEXT NOT NULL,
      response_time REAL,
      polled_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_poll_device_time
      ON poll_results(device_id, polled_at DESC);
  `);

  // Migration: add agent_id to existing devices table if missing
  const cols = db.prepare('PRAGMA table_info(devices)').all();
  if (!cols.find(c => c.name === 'agent_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN agent_id INTEGER');
    console.log('[db] Migrated devices table: added agent_id column');
  }

  console.log('Database initialized at', DB_PATH);
}

module.exports = { getDb, initDb };
