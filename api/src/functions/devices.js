const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

app.http('listDevices', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'devices',
  handler: async (req, ctx) => {
    const authErr = requireAuth(req); if (authErr) return authErr;
    try {
      const pool = await getPool();
      const clientId = parseInt(new URL(req.url).searchParams.get('clientId') || '0') || null;
      const result = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT
            d.*,
            a.name           AS agent_name,
            a.client_id      AS client_id,
            pr.status        AS last_status,
            pr.response_time AS last_response_time,
            pr.polled_at     AS last_polled_at
          FROM devices d
          LEFT JOIN agents a ON a.id = d.agent_id
          LEFT JOIN poll_results pr ON pr.id = (
            SELECT TOP 1 id FROM poll_results
            WHERE device_id = d.id
            ORDER BY polled_at DESC
          )
          WHERE (@clientId IS NULL OR a.client_id = @clientId)
          ORDER BY d.name
        `);
      return { jsonBody: result.recordset };
    } catch (err) {
      ctx.error('listDevices:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('createDevice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'devices',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    const { name, ip_address, type, location, agent_id, snmp_enabled, snmp_community, snmp_port } = await req.json();
    if (!name || !ip_address) {
      return { status: 400, jsonBody: { error: 'name and ip_address are required' } };
    }
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('name',          sql.NVarChar(255), name.trim())
        .input('ip_address',    sql.NVarChar(50),  ip_address.trim())
        .input('type',          sql.NVarChar(50),  type || 'device')
        .input('location',      sql.NVarChar(255), location?.trim() || null)
        .input('agent_id',      sql.Int,           agent_id || null)
        .input('snmp_enabled',  sql.Bit,           snmp_enabled ? 1 : 0)
        .input('snmp_community',sql.NVarChar(100), snmp_community || 'public')
        .input('snmp_port',     sql.Int,           snmp_port || 161)
        .query(`
          INSERT INTO devices (name, ip_address, type, location, agent_id, snmp_enabled, snmp_community, snmp_port)
          OUTPUT INSERTED.id
          VALUES (@name, @ip_address, @type, @location, @agent_id, @snmp_enabled, @snmp_community, @snmp_port)
        `);
      return { status: 201, jsonBody: { id: result.recordset[0].id } };
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'IP address already exists' } };
      }
      ctx.error('createDevice:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('updateDevice', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'devices/{id}',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    const { name, ip_address, type, location, agent_id, snmp_enabled, snmp_community, snmp_port } = await req.json();
    if (!name || !ip_address) {
      return { status: 400, jsonBody: { error: 'name and ip_address are required' } };
    }
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('id',            sql.Int,           parseInt(req.params.id))
        .input('name',          sql.NVarChar(255), name.trim())
        .input('ip_address',    sql.NVarChar(50),  ip_address.trim())
        .input('type',          sql.NVarChar(50),  type || 'device')
        .input('location',      sql.NVarChar(255), location?.trim() || null)
        .input('agent_id',      sql.Int,           agent_id || null)
        .input('snmp_enabled',  sql.Bit,           snmp_enabled ? 1 : 0)
        .input('snmp_community',sql.NVarChar(100), snmp_community || 'public')
        .input('snmp_port',     sql.Int,           snmp_port || 161)
        .query(`
          UPDATE devices
          SET name=@name, ip_address=@ip_address, type=@type, location=@location,
              agent_id=@agent_id, snmp_enabled=@snmp_enabled,
              snmp_community=@snmp_community, snmp_port=@snmp_port
          WHERE id=@id
        `);
      if (result.rowsAffected[0] === 0) {
        return { status: 404, jsonBody: { error: 'Device not found' } };
      }
      return { jsonBody: { ok: true } };
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'IP address already exists' } };
      }
      ctx.error('updateDevice:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('deleteDevice', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'devices/{id}',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('id', sql.Int, parseInt(req.params.id))
        .query('DELETE FROM devices WHERE id=@id');
      if (result.rowsAffected[0] === 0) {
        return { status: 404, jsonBody: { error: 'Device not found' } };
      }
      return { jsonBody: { ok: true } };
    } catch (err) {
      ctx.error('deleteDevice:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
