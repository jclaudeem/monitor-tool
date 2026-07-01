const cron = require('node-cron');
const ping = require('ping');
const { getDb } = require('../db/database');

function parseResponseTime(timeStr) {
  if (!timeStr || timeStr === 'unknown') return null;
  if (typeof timeStr === 'string' && timeStr.startsWith('<')) return 0.5;
  const t = parseFloat(timeStr);
  return isNaN(t) ? null : t;
}

async function pollDevice(device) {
  try {
    const res = await ping.promise.probe(device.ip_address, { timeout: 5 });
    const db = getDb();
    db.prepare(
      'INSERT INTO poll_results (device_id, status, response_time) VALUES (?, ?, ?)'
    ).run(device.id, res.alive ? 'up' : 'down', res.alive ? parseResponseTime(res.time) : null);
    console.log(`[poll] ${device.name} (${device.ip_address}) → ${res.alive ? `UP ${res.time}ms` : 'DOWN'}`);
  } catch (err) {
    console.error(`[poll] Error for ${device.name}: ${err.message}`);
  }
}

async function pollAll() {
  const db = getDb();
  // Only poll devices not managed by an agent
  const devices = db.prepare('SELECT * FROM devices WHERE agent_id IS NULL').all();
  if (devices.length === 0) return;
  await Promise.all(devices.map(pollDevice));
}

function pruneOldResults() {
  const db = getDb();
  const devices = db.prepare('SELECT id FROM devices').all();
  const stmt = db.prepare(`
    DELETE FROM poll_results
    WHERE device_id = ? AND id NOT IN (
      SELECT id FROM poll_results
      WHERE device_id = ?
      ORDER BY polled_at DESC
      LIMIT 1440
    )
  `);
  for (const d of devices) stmt.run(d.id, d.id);
}

function startPoller() {
  pollAll();
  cron.schedule('* * * * *', pollAll);
  cron.schedule('0 3 * * *', pruneOldResults);
  console.log('Poller started — every 60 s (agent-managed devices excluded), pruning at 03:00 daily');
}

module.exports = { startPoller };
