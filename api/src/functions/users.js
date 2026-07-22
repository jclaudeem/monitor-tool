const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin, verifyToken } = require('../auth');

app.http('listUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users',
  handler: async (req, ctx) => {
    const err = requireAdmin(req);
    if (err) return err;
    try {
      const pool = await getPool();
      const r = await pool.request()
        .query('SELECT id, username, role, created_at, last_login FROM users ORDER BY username');
      return { jsonBody: r.recordset };
    } catch (e) {
      ctx.error('listUsers:', e.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('createUser', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users',
  handler: async (req, ctx) => {
    const err = requireAdmin(req);
    if (err) return err;
    const { username, password, role } = await req.json();
    if (!username?.trim() || !password || password.length < 8) {
      return { status: 400, jsonBody: { error: 'Username and password (min 8 chars) required' } };
    }
    const userRole = ['admin', 'viewer'].includes(role) ? role : 'viewer';
    try {
      const pool = await getPool();
      const hash = await bcrypt.hash(password, 10);
      const r = await pool.request()
        .input('username', sql.NVarChar(100), username.trim().toLowerCase())
        .input('hash',     sql.NVarChar(255), hash)
        .input('role',     sql.NVarChar(20),  userRole)
        .query(`
          INSERT INTO users (username, password_hash, role)
          OUTPUT INSERTED.id
          VALUES (@username, @hash, @role)
        `);
      return { status: 201, jsonBody: { id: r.recordset[0].id } };
    } catch (e) {
      if (e.number === 2627 || (e.message || '').includes('UQ_users_username')) {
        return { status: 409, jsonBody: { error: 'Username already exists' } };
      }
      ctx.error('createUser:', e.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('updateUser', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'users/{id}',
  handler: async (req, ctx) => {
    const caller = verifyToken(req);
    if (!caller) return { status: 401, jsonBody: { error: 'Authentication required' } };
    const targetId = parseInt(req.params.id);
    const isSelf = caller.id === targetId;
    const isAdmin = caller.role === 'admin';
    if (!isSelf && !isAdmin) return { status: 403, jsonBody: { error: 'Forbidden' } };

    const { role, password } = await req.json();
    try {
      const pool = await getPool();
      if (role && isAdmin) {
        if (!['admin', 'viewer'].includes(role)) return { status: 400, jsonBody: { error: 'Invalid role' } };
        if (isSelf && role !== 'admin') return { status: 400, jsonBody: { error: 'Cannot remove your own admin role' } };
        await pool.request()
          .input('id',   sql.Int,         targetId)
          .input('role', sql.NVarChar(20), role)
          .query('UPDATE users SET role=@role WHERE id=@id');
      }
      if (password) {
        if (password.length < 8) return { status: 400, jsonBody: { error: 'Password must be at least 8 characters' } };
        const hash = await bcrypt.hash(password, 10);
        await pool.request()
          .input('id',   sql.Int,          targetId)
          .input('hash', sql.NVarChar(255), hash)
          .query('UPDATE users SET password_hash=@hash WHERE id=@id');
      }
      return { jsonBody: { ok: true } };
    } catch (e) {
      ctx.error('updateUser:', e.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

app.http('deleteUser', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'users/{id}',
  handler: async (req, ctx) => {
    const err = requireAdmin(req);
    if (err) return err;
    const caller = verifyToken(req);
    const targetId = parseInt(req.params.id);
    if (caller.id === targetId) {
      return { status: 400, jsonBody: { error: 'Cannot delete your own account' } };
    }
    try {
      const pool = await getPool();
      const r = await pool.request()
        .input('id', sql.Int, targetId)
        .query('DELETE FROM users WHERE id=@id');
      if (r.rowsAffected[0] === 0) return { status: 404, jsonBody: { error: 'User not found' } };
      return { jsonBody: { ok: true } };
    } catch (e) {
      ctx.error('deleteUser:', e.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
