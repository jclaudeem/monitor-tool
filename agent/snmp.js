const snmp = require('net-snmp');

// OID reference
const OIDS = {
  sysDescr:    '1.3.6.1.2.1.1.1.0',
  sysUptime:   '1.3.6.1.2.1.1.3.0',
  sysContact:  '1.3.6.1.2.1.1.4.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
};

const IF_TABLE   = '1.3.6.1.2.1.2.2.1';    // ifTable
const CPU_TABLE  = '1.3.6.1.2.1.25.3.3.1'; // hrProcessorTable
const MEM_TABLE  = '1.3.6.1.2.1.25.2.3.1'; // hrStorageTable

function createSession(ip, community, port) {
  return snmp.createSession(ip, community, {
    version:  snmp.Version2c,
    port:     port || 161,
    timeout:  5000,
    retries:  1,
  });
}

function vbValue(vb) {
  if (snmp.isVarbindError(vb)) return null;
  const v = vb.value;
  if (Buffer.isBuffer(v)) return v.toString('utf8').replace(/\0/g, '').trim();
  return v;
}

function getOids(session, oidList) {
  return new Promise((resolve, reject) => {
    session.get(oidList, (err, varbinds) => {
      if (err) return reject(err);
      const out = {};
      oidList.forEach((oid, i) => { out[oid] = vbValue(varbinds[i]); });
      resolve(out);
    });
  });
}

function walkTable(session, tableOid, columns) {
  return new Promise((resolve, reject) => {
    session.tableColumns(tableOid, columns, (err, table) => {
      if (err) return reject(err);
      resolve(table);
    });
  });
}

async function pollSNMP(device) {
  const community = device.snmp_community || 'public';
  const port      = device.snmp_port || 161;
  const session   = createSession(device.ip_address, community, port);

  const result = { system: null, interfaces: [], cpu: [], memory: [] };

  try {
    // System info
    const sys = await getOids(session, Object.values(OIDS));
    result.system = {
      sysDescr:    sys[OIDS.sysDescr],
      sysUptime:   sys[OIDS.sysUptime],    // hundredths of a second
      sysContact:  sys[OIDS.sysContact],
      sysLocation: sys[OIDS.sysLocation],
    };
  } catch {}

  try {
    // Interfaces: ifDescr(2), ifOperStatus(8), ifInOctets(10), ifOutOctets(16)
    const ifTable = await walkTable(session, IF_TABLE, [2, 8, 10, 16]);
    result.interfaces = Object.entries(ifTable).map(([idx, row]) => ({
      ifIndex:      parseInt(idx),
      ifDescr:      row[2]  ? String(row[2]).trim()  : null,
      ifOperStatus: row[8]  != null ? Number(row[8])  : null, // 1=up, 2=down
      ifInOctets:   row[10] != null ? Number(row[10]) : null,
      ifOutOctets:  row[16] != null ? Number(row[16]) : null,
    })).filter(i => i.ifDescr);
  } catch {}

  try {
    // CPU load: hrProcessorLoad(2)
    const cpuTable = await walkTable(session, CPU_TABLE, [2]);
    result.cpu = Object.values(cpuTable).map(row => Number(row[2])).filter(v => !isNaN(v));
  } catch {}

  try {
    // Memory: hrStorageDescr(3), hrStorageAllocationUnits(4), hrStorageSize(5), hrStorageUsed(6)
    const memTable = await walkTable(session, MEM_TABLE, [3, 4, 5, 6]);
    result.memory = Object.values(memTable).map(row => {
      const desc  = row[3] ? String(row[3]).trim() : '';
      const units = Number(row[4]) || 1;
      const size  = Number(row[5]) || 0;
      const used  = Number(row[6]) || 0;
      return { desc, totalBytes: size * units, usedBytes: used * units };
    }).filter(m => m.desc && m.totalBytes > 0);
  } catch {}

  session.close();
  return result;
}

module.exports = { pollSNMP };
