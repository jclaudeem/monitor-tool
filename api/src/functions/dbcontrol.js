const { app } = require('@azure/functions');
const { setPaused, isPaused } = require('../db');

const TENANT_ID       = process.env.AZURE_TENANT_ID;
const CLIENT_ID       = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET   = process.env.AZURE_CLIENT_SECRET;
const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;

const DB_PATH = `subscriptions/${SUBSCRIPTION_ID}/resourceGroups/monitor-tool-rg/providers/Microsoft.Sql/servers/mt-sql-scus/databases/monitor-tool`;

async function getToken() {
  const resp = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://management.azure.com/.default'
      })
    }
  );
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

// GET /api/dbstatus — reads real DB state from Azure Management API
app.http('dbStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dbstatus',
  handler: async (req, ctx) => {
    try {
      const token = await getToken();
      const resp = await fetch(
        `https://management.azure.com/${DB_PATH}?api-version=2021-11-01`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resp.json();
      const azureStatus = data.properties?.status ?? 'Unknown';
      // If the flag is set, surface that so the UI knows connections are blocked
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
