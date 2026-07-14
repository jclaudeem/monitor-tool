const { app } = require('@azure/functions');
const { getPool, sql, isPaused } = require('../db');

function resolveAgent(req) {
  const getHeader = (name) => typeof req.headers.get === 'function'
    ? req.headers.get(name) : req.headers[name];
  return getHeader('x-agent-key') || '';
}

async function getAgent(req) {
  const apiKey = resolveAgent(req);
  if (!apiKey) return null;
  const pool = await getPool();
  const result = await pool.request()
    .input('key', sql.NVarChar(64), apiKey)
    .query('SELECT * FROM agents WHERE api_key = @key');
  return result.recordset[0] || null;
}

// Agent posts SNMP results
app.http('agentSnmp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'agentsnmp',
  handler: async (req, ctx) => {
    if (isPaused()) return { status: 503, jsonBody: { paused: true } };
    let agent;
    try { agent = await getAgent(req); } catch (err) {
      ctx.error('agentSnmp auth:', err.message);
      return { status: 500, jsonBody: { error: 'Auth error' } };
    }
    if (!agent) return { status: 401, jsonBody: { error: 'Invalid or missing API key' } };

    let body;
    try { body = await req.json(); } catch {
      return { status: 400, jsonBody: { error: 'Invalid JSON' } };
    }

    const { results } = body;
    if (!Array.isArray(results) || results.length === 0) {
      return { status: 400, jsonBody: { error: 'results must be a non-empty array' } };
    }

    try {
      const pool = await getPool();

      const ids = results.map(r => parseInt(r.device_id)).filter(Boolean);
      const owned = await pool.request()
        .input('agent_id', sql.Int, agent.id)
        .query(`SELECT id FROM devices WHERE agent_id = @agent_id AND id IN (${ids.join(',')})`);
      const ownedIds = new Set(owned.recordset.map(r => r.id));

      let accepted = 0;
      for (const r of results) {
        if (!ownedIds.has(parseInt(r.device_id))) continue;
        await pool.request()
          .input('device_id', sql.Int,          parseInt(r.device_id))
          .input('data',      sql.NVarChar(sql.MAX), JSON.stringify(r.data))
          .query('INSERT INTO snmp_results (device_id, data) VALUES (@device_id, @data)');
        accepted++;
      }

      // Prune old SNMP results (keep last 100 per device)
      for (const id of ownedIds) {
        await pool.request().input('id', sql.Int, id).query(`
          DELETE FROM snmp_results WHERE device_id = @id AND id NOT IN (
            SELECT TOP 100 id FROM snmp_results WHERE device_id = @id ORDER BY polled_at DESC
          )
        `);
      }

      return { jsonBody: { ok: true, accepted } };
    } catch (err) {
      ctx.error('agentSnmp insert:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

// Dashboard reads latest SNMP data for a device
app.http('getSnmp', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'snmp/{deviceId}',
  handler: async (req, ctx) => {
    const deviceId = parseInt(req.params.deviceId);
    const limit = Math.min(parseInt(new URL(req.url).searchParams.get('limit') || '1'), 100);
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('device_id', sql.Int, deviceId)
        .input('limit',     sql.Int, limit)
        .query(`
          SELECT TOP (@limit) data, polled_at
          FROM snmp_results
          WHERE device_id = @device_id
          ORDER BY polled_at DESC
        `);
      const rows = result.recordset.map(r => ({
        polled_at: r.polled_at,
        ...JSON.parse(r.data),
      }));
      return { jsonBody: rows };
    } catch (err) {
      ctx.error('getSnmp:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
