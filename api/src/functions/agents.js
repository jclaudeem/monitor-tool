const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const crypto = require('crypto');

async function resolveAgent(req) {
  // headers may be a plain object or a Headers instance depending on runtime
  const auth = (typeof req.headers.get === 'function'
    ? req.headers.get('authorization')
    : req.headers['authorization']) || '';
  if (!auth.startsWith('Bearer ')) return null;
  const apiKey = auth.slice(7);
  const pool = await getPool();
  const result = await pool.request()
    .input('key', sql.NVarChar(64), apiKey)
    .query('SELECT * FROM agents WHERE api_key = @key');
  return result.recordset[0] || null;
}

// ── Dashboard endpoints ──

app.http('listAgents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'agents',
  handler: async (req, ctx) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT a.*, COUNT(d.id) AS device_count
        FROM agents a
        LEFT JOIN devices d ON d.agent_id = a.id
        GROUP BY a.id, a.name, a.location, a.api_key, a.last_seen, a.created_at
        ORDER BY a.name
      `);
      return { jsonBody: result.recordset };
    } catch (err) {
      ctx.error('listAgents:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('createAgent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agents',
  handler: async (req, ctx) => {
    const { name, location } = await req.json();
    if (!name) return { status: 400, jsonBody: { error: 'name is required' } };
    const apiKey = crypto.randomBytes(32).toString('hex');
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('name',     sql.NVarChar(255), name.trim())
        .input('location', sql.NVarChar(255), location?.trim() || null)
        .input('key',      sql.NVarChar(64),  apiKey)
        .query(`
          INSERT INTO agents (name, location, api_key)
          OUTPUT INSERTED.id
          VALUES (@name, @location, @key)
        `);
      return { status: 201, jsonBody: { id: result.recordset[0].id, api_key: apiKey } };
    } catch (err) {
      ctx.error('createAgent:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('deleteAgent', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'agents/{id}',
  handler: async (req, ctx) => {
    const id = parseInt(req.params.id);
    try {
      const pool = await getPool();
      await pool.request()
        .input('id', sql.Int, id)
        .query('UPDATE devices SET agent_id = NULL WHERE agent_id = @id');
      const result = await pool.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM agents WHERE id = @id');
      if (result.rowsAffected[0] === 0) {
        return { status: 404, jsonBody: { error: 'Agent not found' } };
      }
      return { jsonBody: { ok: true } };
    } catch (err) {
      ctx.error('deleteAgent:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

// ── Agent-facing endpoints (authenticated by API key) ──

app.http('getAgentDevices', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'agent/devices',
  handler: async (req, ctx) => {
    let agent;
    try { agent = await resolveAgent(req); } catch (err) {
      ctx.error('resolveAgent (getAgentDevices):', err.message);
      return { status: 500, jsonBody: { error: 'Auth error' } };
    }
    if (!agent) return { status: 401, jsonBody: { error: 'Invalid or missing API key' } };
    try {
      const pool = await getPool();
      const devices = await pool.request()
        .input('agent_id', sql.Int, agent.id)
        .query('SELECT id, name, ip_address, type, location FROM devices WHERE agent_id = @agent_id');
      await pool.request()
        .input('id', sql.Int, agent.id)
        .query('UPDATE agents SET last_seen = GETUTCDATE() WHERE id = @id');
      return { jsonBody: devices.recordset };
    } catch (err) {
      ctx.error('getAgentDevices:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('agentReport', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agent/report',
  handler: async (req, ctx) => {
    let agent;
    try { agent = await resolveAgent(req); } catch (err) {
      ctx.error('resolveAgent (agentReport):', err.message);
      return { status: 500, jsonBody: { error: 'Auth error' } };
    }
    if (!agent) return { status: 401, jsonBody: { error: 'Invalid or missing API key' } };

    const { results } = await req.json();
    if (!Array.isArray(results) || results.length === 0) {
      return { status: 400, jsonBody: { error: 'results must be a non-empty array' } };
    }

    try {
      const pool = await getPool();

      // Verify all device IDs belong to this agent in one query
      const ids = results.map(r => parseInt(r.device_id)).filter(Boolean);
      const owned = await pool.request()
        .input('agent_id', sql.Int, agent.id)
        .query(`SELECT id FROM devices WHERE agent_id = @agent_id AND id IN (${ids.join(',')})`);
      const ownedIds = new Set(owned.recordset.map(r => r.id));

      let accepted = 0;
      for (const r of results) {
        if (!ownedIds.has(parseInt(r.device_id))) continue;
        await pool.request()
          .input('device_id',     sql.Int,   parseInt(r.device_id))
          .input('status',        sql.NVarChar(10), r.status)
          .input('response_time', sql.Float,  r.response_time ?? null)
          .query(`
            INSERT INTO poll_results (device_id, status, response_time)
            VALUES (@device_id, @status, @response_time)
          `);
        accepted++;
      }

      await pool.request()
        .input('id', sql.Int, agent.id)
        .query('UPDATE agents SET last_seen = GETUTCDATE() WHERE id = @id');

      return { jsonBody: { ok: true, accepted } };
    } catch (err) {
      ctx.error('agentReport:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
