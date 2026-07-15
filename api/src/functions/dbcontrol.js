const { app } = require('@azure/functions');
const { setPaused, isPaused } = require('../db');
const { getDbStatus } = require('../azure');

// GET /api/dbstatus — reads real DB state from Azure Management API
app.http('dbStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dbstatus',
  handler: async (req, ctx) => {
    try {
      const azureStatus = await getDbStatus();
      return { status: 200, jsonBody: { status: azureStatus, blocked: isPaused() } };
    } catch (err) {
      ctx.error('dbstatus:', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});

// POST /api/dbpause — sets the in-process flag; DB auto-sleeps within 60 min of no connections
app.http('dbPause', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dbpause',
  handler: async (req, ctx) => {
    setPaused(true);
    return { status: 200, jsonBody: { ok: true } };
  }
});

// POST /api/dbresume — clears the flag; next dashboard load triggers Azure auto-resume
app.http('dbResume', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dbresume',
  handler: async (req, ctx) => {
    setPaused(false);
    return { status: 200, jsonBody: { ok: true } };
  }
});
