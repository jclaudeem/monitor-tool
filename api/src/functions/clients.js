const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

app.http('listClients', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'clients',
  handler: async (req, ctx) => {
    const authErr = requireAuth(req); if (authErr) return authErr;
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT
          c.id, c.name, c.contact_name, c.contact_email, c.contact_phone, c.created_at,
          COUNT(DISTINCT a.id) AS agent_count,
          COUNT(DISTINCT d.id) AS device_count
        FROM clients c
        LEFT JOIN agents a ON a.client_id = c.id
        LEFT JOIN devices d ON d.agent_id = a.id
        GROUP BY c.id, c.name, c.contact_name, c.contact_email, c.contact_phone, c.created_at
        ORDER BY c.name
      `);
      return { jsonBody: result.recordset };
    } catch (err) {
      ctx.error('listClients:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('createClient', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'clients',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    const { name, contact_name, contact_email, contact_phone } = await req.json();
    if (!name?.trim()) return { status: 400, jsonBody: { error: 'name is required' } };
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('name',          sql.NVarChar(100), name.trim())
        .input('contact_name',  sql.NVarChar(100), contact_name?.trim()  || null)
        .input('contact_email', sql.NVarChar(150), contact_email?.trim() || null)
        .input('contact_phone', sql.NVarChar(30),  contact_phone?.trim() || null)
        .query(`
          INSERT INTO clients (name, contact_name, contact_email, contact_phone)
          OUTPUT INSERTED.id
          VALUES (@name, @contact_name, @contact_email, @contact_phone)
        `);
      return { status: 201, jsonBody: { id: result.recordset[0].id } };
    } catch (err) {
      ctx.error('createClient:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('updateClient', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'clients/{id}',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    const { name, contact_name, contact_email, contact_phone } = await req.json();
    if (!name?.trim()) return { status: 400, jsonBody: { error: 'name is required' } };
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('id',            sql.Int,           parseInt(req.params.id))
        .input('name',          sql.NVarChar(100), name.trim())
        .input('contact_name',  sql.NVarChar(100), contact_name?.trim()  || null)
        .input('contact_email', sql.NVarChar(150), contact_email?.trim() || null)
        .input('contact_phone', sql.NVarChar(30),  contact_phone?.trim() || null)
        .query(`
          UPDATE clients
          SET name=@name, contact_name=@contact_name,
              contact_email=@contact_email, contact_phone=@contact_phone
          WHERE id=@id
        `);
      if (result.rowsAffected[0] === 0) return { status: 404, jsonBody: { error: 'Client not found' } };
      return { jsonBody: { ok: true } };
    } catch (err) {
      ctx.error('updateClient:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('deleteClient', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'clients/{id}',
  handler: async (req, ctx) => {
    const authErr = requireAdmin(req); if (authErr) return authErr;
    try {
      const pool = await getPool();
      const id = parseInt(req.params.id);
      // Unassign agents (don't delete them)
      await pool.request()
        .input('id', sql.Int, id)
        .query('UPDATE agents SET client_id = NULL WHERE client_id = @id');
      const result = await pool.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM clients WHERE id = @id');
      if (result.rowsAffected[0] === 0) return { status: 404, jsonBody: { error: 'Client not found' } };
      return { jsonBody: { ok: true } };
    } catch (err) {
      ctx.error('deleteClient:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
