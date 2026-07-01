const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

router.get('/summary', (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS count FROM devices').get().count;
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN last_status = 'up'   THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN last_status = 'down' THEN 1 ELSE 0 END) AS down,
      SUM(CASE WHEN last_status IS NULL  THEN 1 ELSE 0 END) AS unknown
    FROM (
      SELECT (
        SELECT status FROM poll_results
        WHERE device_id = d.id
        ORDER BY polled_at DESC LIMIT 1
      ) AS last_status
      FROM devices d
    )
  `).get();
  res.json({ total, up: row.up || 0, down: row.down || 0, unknown: row.unknown || 0 });
});

router.get('/history/:deviceId', (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit) || 100, 1440);
  const rows = db.prepare(
    'SELECT * FROM poll_results WHERE device_id=? ORDER BY polled_at DESC LIMIT ?'
  ).all(req.params.deviceId, limit);
  res.json(rows);
});

module.exports = router;
