const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/database');

function authAgent(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing API key' });
  const apiKey = auth.slice(7);
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE api_key = ?').get(apiKey);
  if (!agent) return res.status(401).json({ error: 'Invalid API key' });
  req.agent = agent;
  next();
}

// List all agents with device count
router.get('/', (req, res) => {
  const db = getDb();
  const agents = db.prepare(`
    SELECT a.*, COUNT(d.id) AS device_count
    FROM agents a
    LEFT JOIN devices d ON d.agent_id = a.id
    GROUP BY a.id
    ORDER BY a.name
  `).all();
  res.json(agents);
});

// Create agent — returns API key once
router.post('/', (req, res) => {
  const { name, location } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const apiKey = crypto.randomBytes(32).toString('hex');
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO agents (name, location, api_key) VALUES (?, ?, ?)'
  ).run(name.trim(), location?.trim() || null, apiKey);
  res.status(201).json({ id: result.lastInsertRowid, api_key: apiKey });
});

// Delete agent (unassigns its devices first)
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE devices SET agent_id = NULL WHERE agent_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Agent not found' });
  res.json({ ok: true });
});

// ── Agent-facing endpoints (authenticated by API key) ──

// Agent fetches its assigned devices
router.get('/devices', authAgent, (req, res) => {
  const db = getDb();
  const devices = db.prepare(
    'SELECT id, name, ip_address, type, location FROM devices WHERE agent_id = ?'
  ).all(req.agent.id);
  db.prepare('UPDATE agents SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(req.agent.id);
  res.json(devices);
});

// Agent submits poll results
router.post('/report', authAgent, (req, res) => {
  const { results } = req.body;
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'results must be a non-empty array' });
  }

  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO poll_results (device_id, status, response_time) VALUES (?, ?, ?)'
  );
  // Verify each device belongs to this agent before inserting
  const checkDevice = db.prepare(
    'SELECT id FROM devices WHERE id = ? AND agent_id = ?'
  );

  const insertMany = db.transaction((rows) => {
    let accepted = 0;
    for (const r of rows) {
      if (checkDevice.get(r.device_id, req.agent.id)) {
        insert.run(r.device_id, r.status, r.response_time ?? null);
        accepted++;
      }
    }
    return accepted;
  });

  const accepted = insertMany(results);
  db.prepare('UPDATE agents SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(req.agent.id);
  res.json({ ok: true, accepted });
});

module.exports = router;
module.exports.authAgent = authAgent;
