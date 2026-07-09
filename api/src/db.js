const sql = require('mssql');

let pool = null;
let initialized = false;

async function getPool() {
  if (!pool) {
    // Azure SQL Serverless auto-pauses; first connect attempt wakes it but times out (~15s).
    // Retry once after 25s — the DB should be ready by then.
    for (let attempt = 1; attempt <= 2; attempt++) {
      pool = new sql.ConnectionPool(process.env.AZURE_SQL_CONNECTION_STRING);
      pool.on('error', () => { pool = null; initialized = false; });
      try {
        await pool.connect();
        break;
      } catch (err) {
        pool = null;
        if (attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 25000));
      }
    }
  }
  if (!initialized) {
    await initSchema();
    initialized = true;
  }
  return pool;
}

async function initSchema() {
  const p = pool;

  await p.request().query(`
    IF OBJECT_ID('agents', 'U') IS NULL
    CREATE TABLE agents (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      name       NVARCHAR(255) NOT NULL,
      location   NVARCHAR(255),
      api_key    NVARCHAR(64)  NOT NULL,
      last_seen  DATETIME2,
      created_at DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT UQ_agents_key UNIQUE (api_key)
    )
  `);

  await p.request().query(`
    IF OBJECT_ID('devices', 'U') IS NULL
    CREATE TABLE devices (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      name        NVARCHAR(255) NOT NULL,
      ip_address  NVARCHAR(50)  NOT NULL,
      type        NVARCHAR(50)  NOT NULL DEFAULT 'device',
      location    NVARCHAR(255),
      agent_id    INT,
      created_at  DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT UQ_devices_ip UNIQUE (ip_address),
      CONSTRAINT FK_devices_agent FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  await p.request().query(`
    IF OBJECT_ID('poll_results', 'U') IS NULL
    CREATE TABLE poll_results (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      device_id     INT NOT NULL,
      status        NVARCHAR(10) NOT NULL,
      response_time FLOAT,
      polled_at     DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT FK_poll_device FOREIGN KEY (device_id)
        REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'idx_poll_device_time'
        AND object_id = OBJECT_ID('poll_results')
    )
    CREATE INDEX idx_poll_device_time ON poll_results(device_id, polled_at DESC)
  `);

  // SNMP columns on devices (added after initial schema)
  await p.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('devices') AND name='snmp_enabled')
      ALTER TABLE devices ADD snmp_enabled BIT NOT NULL DEFAULT 0
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('devices') AND name='snmp_community')
      ALTER TABLE devices ADD snmp_community NVARCHAR(100) NOT NULL DEFAULT 'public'
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('devices') AND name='snmp_port')
      ALTER TABLE devices ADD snmp_port INT NOT NULL DEFAULT 161
  `);

  await p.request().query(`
    IF OBJECT_ID('snmp_results', 'U') IS NULL
    CREATE TABLE snmp_results (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      device_id INT NOT NULL,
      data      NVARCHAR(MAX) NOT NULL,
      polled_at DATETIME2 DEFAULT GETUTCDATE(),
      CONSTRAINT FK_snmp_device FOREIGN KEY (device_id)
        REFERENCES devices(id) ON DELETE CASCADE
    )
  `);
  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name='idx_snmp_device_time' AND object_id=OBJECT_ID('snmp_results')
    )
    CREATE INDEX idx_snmp_device_time ON snmp_results(device_id, polled_at DESC)
  `);
}

module.exports = { getPool, sql };
