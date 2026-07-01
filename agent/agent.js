const cron = require('node-cron');
const ping = require('ping');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[agent] config.json not found.');
    console.error('[agent] Copy config.example.json → config.json and fill in serverUrl and apiKey.');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  if (!cfg.serverUrl || !cfg.apiKey) {
    console.error('[agent] config.json must contain serverUrl and apiKey.');
    process.exit(1);
  }
  cfg.pollInterval = cfg.pollInterval || 60;
  return cfg;
}

function parseResponseTime(timeStr) {
  if (!timeStr || timeStr === 'unknown') return null;
  if (typeof timeStr === 'string' && timeStr.startsWith('<')) return 0.5;
  const t = parseFloat(timeStr);
  return isNaN(t) ? null : t;
}

async function fetchDevices(config) {
  const res = await axios.get(`${config.serverUrl}/api/agents/devices`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeout: 10000,
  });
  return res.data;
}

async function pollDevices(devices) {
  return Promise.all(devices.map(async (device) => {
    try {
      const res = await ping.promise.probe(device.ip_address, { timeout: 5 });
      const status = res.alive ? 'up' : 'down';
      const responseTime = res.alive ? parseResponseTime(res.time) : null;
      console.log(`[poll] ${device.name} (${device.ip_address}) → ${res.alive ? `UP ${res.time}ms` : 'DOWN'}`);
      return { device_id: device.id, status, response_time: responseTime };
    } catch (err) {
      console.error(`[poll] Error pinging ${device.name} (${device.ip_address}): ${err.message}`);
      return { device_id: device.id, status: 'down', response_time: null };
    }
  }));
}

async function sendReport(config, results) {
  await axios.post(`${config.serverUrl}/api/agents/report`, { results }, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

async function cycle(config) {
  try {
    const devices = await fetchDevices(config);
    if (devices.length === 0) {
      console.log('[agent] No devices assigned to this agent yet — assign devices via the dashboard.');
      return;
    }
    const results = await pollDevices(devices);
    await sendReport(config, results);
    console.log(`[agent] Reported ${results.length} result(s) → ${config.serverUrl}`);
  } catch (err) {
    if (err.response) {
      console.error(`[agent] Server error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error(`[agent] Cannot reach server at ${config.serverUrl} — will retry next cycle`);
    } else {
      console.error(`[agent] Unexpected error: ${err.message}`);
    }
  }
}

async function main() {
  const config = loadConfig();
  console.log(`[agent] Starting — server: ${config.serverUrl}`);
  console.log(`[agent] Poll interval: ${config.pollInterval}s`);

  // Run immediately on start
  await cycle(config);

  // Then on the cron schedule (every N seconds via repeated check or just every minute)
  cron.schedule('* * * * *', () => cycle(config));
}

main();
