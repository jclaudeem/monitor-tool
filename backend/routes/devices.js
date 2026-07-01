const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

router.get('/', (req, res) => {
  const db = getDb();
  const devices = db.prepare(`
    SELECT
      d.*,
      a.name        AS agent_name,
      pr.status        AS last_status,
      pr.response_time AS last_response_time,
      pr.polled_at     AS last_polled_at
    FROM devices d
    LEFT JOIN agents a ON a.id = d.agent_id
    LEFT JOIN poll_results pr ON pr.id = (
      SELECT id FROM poll_results
      WHERE device_id = d.id
      ORDER BY polled_at DESC
      LIMIT 1
    )
    ORDER BY d.name
  `).all();
  res.json(devices);
});

router.post('/', (req, res) => {
  const { name, ip_address, type, location, agent_id } = req.body;
  if (!name || !ip_address) {
    return res.status(400).json({ error: 'name and ip_address are required' });
  }
  try {
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO devices (name, ip_address, type, location, agent_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), ip_address.trim(), type || 'device', location?.trim() || null, agent_id || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'IP address already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { name, ip_address, type, location, agent_id } = req.body;
  if (!name || !ip_address) {
    return res.status(400).json({ error: 'name and ip_address are required' });
  }
  try {
    const db = getDb();
    const result = db.prepare(
      'UPDATE devices SET name=?, ip_address=?, type=?, location=?, agent_id=? WHERE id=?'
    ).run(name.trim(), ip_address.trim(), type || 'device', location?.trim() || null, agent_id || null, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'IP address already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM devices WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
  res.json({ ok: true });
});

module.exports = router;
