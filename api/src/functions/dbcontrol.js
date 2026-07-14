const { app } = require('@azure/functions');
const { setPaused } = require('../db');

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;

const DB_PATH = `subscriptions/${SUBSCRIPTION_ID}/resourceGroups/monitor-tool-rg/providers/Microsoft.Sql/servers/mt-sql-scus/databases/monitor-tool`;
const MGMT = 'https://management.azure.com';
const API_VER = '2021-11-01';

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

app.http('dbStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dbstatus',
  handler: async (req, ctx) => {
    try {
      const token = await getToken();
      const resp = await fetch(`${MGMT}/${DB_PATH}?api-version=${API_VER}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await resp.json();
      return { status: 200, jsonBody: { status: data.properties?.status ?? 'Unknown' } };
    } catch (err) {
      ctx.error('dbstatus:', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});

app.http('dbPause', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dbpause',
  handler: async (req, ctx) => {
    try {
      const token = await getToken();
      const resp = await fetch(`${MGMT}/${DB_PATH}/pause?api-version=${API_VER}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
      });
      if (resp.status === 200 || resp.status === 202) {
        setPaused(true);
        return { status: 200, jsonBody: { ok: true } };
      }
      const body = await resp.text();
      return { status: 500, jsonBody: { error: body } };
    } catch (err) {
      ctx.error('dbpause:', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});

app.http('dbResume', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dbresume',
  handler: async (req, ctx) => {
    try {
      const token = await getToken();
      const resp = await fetch(`${MGMT}/${DB_PATH}/resume?api-version=${API_VER}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
      });
      if (resp.status === 200 || resp.status === 202) {
        setPaused(false);
        return { status: 200, jsonBody: { ok: true } };
      }
      const body = await resp.text();
      return { status: 500, jsonBody: { error: body } };
    } catch (err) {
      ctx.error('dbresume:', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  }
});
