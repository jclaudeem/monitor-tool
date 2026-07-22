const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../auth');

async function resolveAgent(req) {
  // Use X-Agent-Key instead of Authorization — SWA intercepts Authorization headers
  const getHeader = (name) => typeof req.headers.get === 'function'
    ? req.headers.get(name)
    : req.headers[name];
  const apiKey = getHeader('x-agent-key') || '';
  if (!apiKey) return null;
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
    const authErr = requireAuth(req); if (authErr) return authErr;
    try {
      const pool = await getPool();
      const clientId = parseInt(new URL(req.url).searchParams.get('clientId') || '0') || null;
      const result = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT a.id, a.name, a.location, a.api_key, a.last_seen, a.created_at,
                 a.client_id, c.name AS client_name,
                 COUNT(d.id) AS device_count
          FROM agents a
          LEFT JOIN clients c ON c.id = a.client_id
          LEFT JOIN devices d ON d.agent_id = a.id
          WHERE (@clientId IS NULL OR a.client_id = @clientId)
          GROUP BY a.id, a.name, a.location, a.api_key, a.last_seen, a.created_at,
                   a.client_id, c.name
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
    const authErr = requireAdmin(req); if (authErr) return authErr;
    const { name, location, client_id } = await req.json();
    if (!name) return { status: 400, jsonBody: { error: 'name is required' } };
    const apiKey = crypto.randomBytes(32).toString('hex');
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('name',      sql.NVarChar(255), name.trim())
        .input('location',  sql.NVarChar(255), location?.trim() || null)
        .input('client_id', sql.Int,           client_id || null)
        .input('key',       sql.NVarChar(64),  apiKey)
        .query(`
          INSERT INTO agents (name, location, client_id, api_key)
          OUTPUT INSERTED.id
          VALUES (@name, @location, @client_id, @key)
        `);
      return { status: 201, jsonBody: { id: result.recordset[0].id, api_key: apiKey } };
    } catch (err) {
      ctx.error('createAgent:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('updateAgent', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'agents/{id}',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    const { name, location, client_id } = await req.json();
    if (!name?.trim()) return { status: 400, jsonBody: { error: 'name is required' } };
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('id',        sql.Int,           parseInt(req.params.id))
        .input('name',      sql.NVarChar(255), name.trim())
        .input('location',  sql.NVarChar(255), location?.trim() || null)
        .input('client_id', sql.Int,           client_id || null)
        .query(`
          UPDATE agents SET name=@name, location=@location, client_id=@client_id
          WHERE id=@id
        `);
      if (result.rowsAffected[0] === 0) return { status: 404, jsonBody: { error: 'Agent not found' } };
      return { jsonBody: { ok: true } };
    } catch (err) {
      ctx.error('updateAgent:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('deleteAgent', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'agents/{id}',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
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
  route: 'agentdevices',
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
        .query('SELECT id, name, ip_address, type, location, snmp_enabled, snmp_community, snmp_port FROM devices WHERE agent_id = @agent_id');
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
  route: 'agentreport',
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

      // Prune poll_results older than 7 days
      for (const devId of [...ownedIds]) {
        await pool.request()
          .input('did', sql.Int, devId)
          .query(`DELETE FROM poll_results WHERE device_id = @did AND polled_at < DATEADD(DAY, -7, GETUTCDATE())`);
      }

      return { jsonBody: { ok: true, accepted } };
    } catch (err) {
      ctx.error('agentReport:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
