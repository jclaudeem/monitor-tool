const cron = require('node-cron');
const ping = require('ping');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { pollSNMP } = require('./snmp');

const CONFIG_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_PATH    = path.join(CONFIG_DIR, 'MonitorAgent.log');
const TASK_NAME   = 'MonitorToolAgent';

// ── Logging ──────────────────────────────────────────────────────────────────

const HAS_TTY = Boolean(process.stdout.isTTY);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (HAS_TTY) console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

function trimLog() {
  try {
    const content = fs.readFileSync(LOG_PATH, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > 2000) {
      fs.writeFileSync(LOG_PATH, lines.slice(-1000).join('\n'));
    }
  } catch {}
}

// ── Service install / uninstall ───────────────────────────────────────────────

function installService() {
  const exePath = process.pkg ? process.execPath : path.resolve(process.argv[1]);

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('\n[install] No config.json found. Run without --install first to set up the server URL and API key.\n');
    process.exit(1);
  }

  console.log('\n[install] Registering Windows startup task...');
  try {
    // Quote the exe path in case it contains spaces
    const tr = `\\"${exePath}\\"`;
    execSync(
      `schtasks /create /tn "${TASK_NAME}" /tr ${tr} /sc ONSTART /ru SYSTEM /rl HIGHEST /f`,
      { stdio: 'inherit' }
    );
    console.log(`\n[install] Done! "${TASK_NAME}" will start automatically on next system boot.`);
    console.log('[install] To remove the service: MonitorAgent.exe --uninstall');
    console.log('[install] Log file: ' + LOG_PATH);
  } catch (err) {
    console.error('\n[install] Failed — try running as Administrator.');
    process.exit(1);
  }
}

function uninstallService() {
  console.log('\n[uninstall] Removing Windows startup task...');
  try { execSync(`schtasks /end /tn "${TASK_NAME}"`, { stdio: 'pipe' }); } catch {}
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'inherit' });
    console.log(`[uninstall] "${TASK_NAME}" removed.`);
  } catch {
    console.error('[uninstall] Task not found or already removed.');
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

async function promptSetup() {
  if (!HAS_TTY) {
    log('[error] No config.json found and no terminal available for setup. Run MonitorAgent.exe interactively first.');
    process.exit(1);
  }

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
  if (!fs.existsSync(CONFIG_PATH)) return promptSetup();
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error('[agent] config.json is invalid — re-running setup.');
    fs.unlinkSync(CONFIG_PATH);
    return promptSetup();
  }
  if (!cfg.serverUrl || !cfg.apiKey) {
    console.error('[agent] config.json missing serverUrl or apiKey — re-running setup.');
    fs.unlinkSync(CONFIG_PATH);
    return promptSetup();
  }
  cfg.pollInterval = cfg.pollInterval || 60;
  return cfg;
}

// ── Monitoring ───────────────────────────────────────────────────────────────

function parseResponseTime(timeStr) {
  if (!timeStr || timeStr === 'unknown') return null;
  if (typeof timeStr === 'string' && timeStr.startsWith('<')) return 0.5;
  const t = parseFloat(timeStr);
  return isNaN(t) ? null : t;
}

async function fetchDevices(config) {
  const res = await axios.get(`${config.serverUrl}/api/agentdevices`, {
    headers: { 'X-Agent-Key': config.apiKey },
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
      log(`[poll] ${device.name} (${device.ip_address}) -> ${res.alive ? `UP ${res.time}ms` : 'DOWN'}`);
      return { device_id: device.id, status, response_time: responseTime };
    } catch (err) {
      log(`[poll] Error pinging ${device.name} (${device.ip_address}): ${err.message}`);
      return { device_id: device.id, status: 'down', response_time: null };
    }
  }));
}

async function sendReport(config, results) {
  await axios.post(`${config.serverUrl}/api/agentreport`, { results }, {
    headers: { 'X-Agent-Key': config.apiKey, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

async function sendSnmpReport(config, results) {
  await axios.post(`${config.serverUrl}/api/agentsnmp`, { results }, {
    headers: { 'X-Agent-Key': config.apiKey, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

async function pollSnmpDevices(devices) {
  const snmpDevices = devices.filter(d => d.snmp_enabled);
  if (snmpDevices.length === 0) return [];
  return Promise.all(snmpDevices.map(async (device) => {
    try {
      const data = await pollSNMP(device);
      log(`[snmp] ${device.name} (${device.ip_address}) -> sys:${!!data.system} ifaces:${data.interfaces.length} cpu:${data.cpu.length} mem:${data.memory.length}`);
      return { device_id: device.id, data };
    } catch (err) {
      log(`[snmp] Error polling ${device.name}: ${err.message}`);
      return null;
    }
  })).then(r => r.filter(Boolean));
}

async function cycle(config) {
  try {
    const devices = await fetchDevices(config);
    if (devices.length === 0) {
      log('[agent] No devices assigned yet — assign devices via the dashboard.');
      return;
    }

    // Ping poll (all devices)
    const pingResults = await pollDevices(devices);
    await sendReport(config, pingResults);
    log(`[agent] Ping: reported ${pingResults.length} result(s)`);

    // SNMP poll (SNMP-enabled devices only)
    const snmpResults = await pollSnmpDevices(devices);
    if (snmpResults.length > 0) {
      await sendSnmpReport(config, snmpResults);
      log(`[agent] SNMP: reported ${snmpResults.length} result(s)`);
    }
  } catch (err) {
    if (err.response) {
      log(`[agent] Server error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      log(`[agent] Cannot reach server at ${config.serverUrl} — will retry next cycle`);
    } else {
      log(`[agent] Unexpected error: ${err.message}`);
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--install'))   { installService();   process.exit(0); }
  if (args.includes('--uninstall')) { uninstallService(); process.exit(0); }

  if (HAS_TTY) {
    console.log('');
    console.log('  +---------------------------------+');
    console.log('  |   Monitor Tool Agent  v1.0      |');
    console.log('  +---------------------------------+');
  }

  const config = await loadConfig();

  trimLog();
  log(`[agent] Starting — server: ${config.serverUrl}`);
  log(`[agent] Polling every ${config.pollInterval}s`);
  if (HAS_TTY) {
    console.log('\n  Run with --install  to register as a Windows startup service');
    console.log('  Run with --uninstall to remove the startup service');
    console.log(`  Log file: ${LOG_PATH}\n`);
  }

  await cycle(config);
  cron.schedule('* * * * *', () => cycle(config));
}

main();
