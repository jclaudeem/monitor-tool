// Shared Azure Management API helpers (token + DB status)
const TENANT_ID       = process.env.AZURE_TENANT_ID;
const CLIENT_ID       = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET   = process.env.AZURE_CLIENT_SECRET;
const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID;

const DB_RESOURCE = `https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/monitor-tool-rg/providers/Microsoft.Sql/servers/mt-sql-scus/databases/monitor-tool`;

let _tokenCache = null;

async function getToken() {
  if (_tokenCache && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
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
  _tokenCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return _tokenCache.token;
}

async function getDbStatus() {
  const token = await getToken();
  const resp = await fetch(`${DB_RESOURCE}?api-version=2021-11-01`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await resp.json();
  return data.properties?.status ?? 'Unknown';
}

module.exports = { getToken, getDbStatus, DB_RESOURCE };
