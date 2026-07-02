const cron = require('node-cron');
const ping = require('ping');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// When running as a pkg .exe, save config next to the exe; otherwise next to the script
const CONFIG_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

async function promptSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, res));

  console.log('');
  console.log('  Monitor Tool Agent - First Run Setup');
  console.log('  =====================================');
  console.log('  You can find your Server URL and API Key in the dashboard under Agents.');
  console.log('');

  const serverUrl = (await ask('  Server URL : ')).trim().replace(/\/$/, '');
  const apiKey    = (await ask('  API Key    : ')).trim();
  rl.close();

  if (!serverUrl || !apiKey) {
    console.error('\n[error] Both fields are required. Exiting.');
    process.exit(1);
  }

  const config = { serverUrl, apiKey, pollInterval: 60 };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\n[agent] Config saved to: ${CONFIG_PATH}`);
  return config;
}

async function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return promptSetup();
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error('[agent] config.json is invalid — re-running setup.');
    fs.unlinkSync(CONFIG_PATH);
    return promptSetup();
  }
  if (!cfg.serverUrl || !cfg.apiKey) {
    console.error('[agent] config.json is missing serverUrl or apiKey — re-running setup.');
    fs.unlinkSync(CONFIG_PATH);
    return promptSetup();
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
      console.log(`[poll] ${device.name} (${device.ip_address}) -> ${res.alive ? `UP ${res.time}ms` : 'DOWN'}`);
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
      console.log('[agent] No devices assigned yet — assign devices via the dashboard.');
      return;
    }
    const results = await pollDevices(devices);
    await sendReport(config, results);
    console.log(`[agent] Reported ${results.length} result(s) -> ${config.serverUrl}`);
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
  console.log('');
  console.log('  +---------------------------------+');
  console.log('  |   Monitor Tool Agent  v1.0      |');
  console.log('  +---------------------------------+');

  const config = await loadConfig();

  console.log(`\n[agent] Server : ${config.serverUrl}`);
  console.log(`[agent] Polling every ${config.pollInterval}s\n`);

  await cycle(config);
  cron.schedule('* * * * *', () => cycle(config));
}

main();
