const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../auth');

const EXPIRES = '8h';

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET(), { expiresIn: EXPIRES });
}

// Check if system has any users yet (first-run detection)
app.http('setupCheck', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'setup',
  handler: async (req, ctx) => {
    try {
      const pool = await getPool();
      const r = await pool.request().query('SELECT COUNT(*) AS cnt FROM users');
      return { jsonBody: { configured: r.recordset[0].cnt > 0 } };
    } catch (err) {
      ctx.error('setupCheck:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

// Create first admin — fails if any user already exists
app.http('setupCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'setup',
  handler: async (req, ctx) => {
    try {
      const pool = await getPool();
      const existing = await pool.request().query('SELECT COUNT(*) AS cnt FROM users');
      if (existing.recordset[0].cnt > 0) {
        return { status: 409, jsonBody: { error: 'System already configured — use the login page' } };
      }
      const { username, password } = await req.json();
      if (!username?.trim() || !password || password.length < 8) {
        return { status: 400, jsonBody: { error: 'Username and password (min 8 chars) required' } };
      }
      const hash = await bcrypt.hash(password, 10);
      const r = await pool.request()
        .input('username', sql.NVarChar(100), username.trim().toLowerCase())
        .input('hash',     sql.NVarChar(255), hash)
        .query(`
          INSERT INTO users (username, password_hash, role)
          OUTPUT INSERTED.id
          VALUES (@username, @hash, 'admin')
        `);
      const user = { id: r.recordset[0].id, username: username.trim().toLowerCase(), role: 'admin' };
      return { status: 201, jsonBody: { token: makeToken(user), username: user.username, role: user.role } };
    } catch (err) {
      ctx.error('setupCreate:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});

// Login
app.http('login', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'login',
  handler: async (req, ctx) => {
    const { username, password } = await req.json();
    if (!username || !password) {
      return { status: 400, jsonBody: { error: 'Username and password required' } };
    }
    try {
      const pool = await getPool();
      const r = await pool.request()
        .input('username', sql.NVarChar(100), username.trim().toLowerCase())
        .query('SELECT * FROM users WHERE username = @username');
      const user = r.recordset[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return { status: 401, jsonBody: { error: 'Invalid username or password' } };
      }
      await pool.request()
        .input('id', sql.Int, user.id)
        .query('UPDATE users SET last_login = GETUTCDATE() WHERE id = @id');
      return { jsonBody: { token: makeToken(user), username: user.username, role: user.role } };
    } catch (err) {
      ctx.error('login:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
