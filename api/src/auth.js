const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-in-production';

function getToken(req) {
  const h = (name) => typeof req.headers.get === 'function' ? req.headers.get(name) : req.headers[name];
  return h('x-auth-token') || '';
}

function verifyToken(req) {
  const token = getToken(req);
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET());
  } catch {
    return null;
  }
}

function requireAuth(req) {
  if (!verifyToken(req)) return { status: 401, jsonBody: { error: 'Authentication required' } };
  return null;
}

function requireAdmin(req) {
  const user = verifyToken(req);
  if (!user) return { status: 401, jsonBody: { error: 'Authentication required' } };
  if (user.role !== 'admin') return { status: 403, jsonBody: { error: 'Admin access required' } };
  return null;
}

module.exports = { verifyToken, requireAuth, requireAdmin, SECRET };
