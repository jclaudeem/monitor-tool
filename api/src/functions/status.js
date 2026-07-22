const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth } = require('../auth');

app.http('getSummary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status/summary',
  handler: async (req, ctx) => {
    const authErr = requireAuth(req); if (authErr) return authErr;
    try {
      const pool = await getPool();
      const clientId = parseInt(new URL(req.url).searchParams.get('clientId') || '0') || null;

      const totalResult = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT COUNT(*) AS count FROM devices d
          LEFT JOIN agents a ON a.id = d.agent_id
          WHERE (@clientId IS NULL OR a.client_id = @clientId)
        `);
      const total = totalResult.recordset[0].count;

      const statsResult = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT
            SUM(CASE WHEN last_status = 'up'   THEN 1 ELSE 0 END) AS [up],
            SUM(CASE WHEN last_status = 'down' THEN 1 ELSE 0 END) AS [down],
            SUM(CASE WHEN last_status IS NULL  THEN 1 ELSE 0 END) AS [unknown]
          FROM (
            SELECT (
              SELECT TOP 1 status FROM poll_results
              WHERE device_id = d.id ORDER BY polled_at DESC
            ) AS last_status
            FROM devices d
            LEFT JOIN agents a ON a.id = d.agent_id
            WHERE (@clientId IS NULL OR a.client_id = @clientId)
          ) s
        `);

      const { up, down, unknown } = statsResult.recordset[0];
      return { jsonBody: { total, up: up || 0, down: down || 0, unknown: unknown || 0 } };
    } catch (err) {
      ctx.error('getSummary:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('getHistory', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status/history/{deviceId}',
  handler: async (req, ctx) => {
    const authErr = requireAuth(req); if (authErr) return authErr;
    const limit = Math.min(parseInt(req.query.get('limit') || '100'), 1440);
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('device_id', sql.Int, parseInt(req.params.deviceId))
        .input('limit',     sql.Int, limit)
        .query(`
          SELECT TOP (@limit) *
          FROM poll_results
          WHERE device_id = @device_id
          ORDER BY polled_at DESC
        `);
      return { jsonBody: result.recordset };
    } catch (err) {
      ctx.error('getHistory:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
