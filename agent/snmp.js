const snmp = require('net-snmp');

// OID reference
const OIDS = {
  sysDescr:    '1.3.6.1.2.1.1.1.0',
  sysUptime:   '1.3.6.1.2.1.1.3.0',
  sysContact:  '1.3.6.1.2.1.1.4.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
};

// Table base OIDs (we walk the subtree and parse manually — better device compat)
const IF_ENTRY  = '1.3.6.1.2.1.2.2.1';   // ifEntry columns: 2=Descr,8=OperStatus,10=InOctets,16=OutOctets
const CPU_ENTRY = '1.3.6.1.2.1.25.3.3.1'; // hrProcessorEntry column: 2=Load
const MEM_ENTRY = '1.3.6.1.2.1.25.2.3.1'; // hrStorageEntry columns: 3=Descr,4=Units,5=Size,6=Used

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

// Simple GET for a fixed list of OIDs
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

// Walk a subtree, return { oid: value } map
function subtreeWalk(session, baseOid) {
  return new Promise((resolve, reject) => {
    const results = {};
    session.subtree(baseOid, 20,
      (varbinds) => {
        for (const vb of varbinds) {
          if (!snmp.isVarbindError(vb)) results[vb.oid] = vbValue(vb);
        }
      },
      (err) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
}

// Parse a flat OID map into a table: { rowIndex: { colNum: value } }
// Expected OID format: baseOid.colNum.rowIndex
function parseTable(oidMap, baseOid) {
  const table = {};
  const prefix = baseOid + '.';
  for (const [oid, val] of Object.entries(oidMap)) {
    if (!oid.startsWith(prefix)) continue;
    const rest  = oid.slice(prefix.length).split('.');
    if (rest.length < 2) continue;
    const col   = rest[0];
    const rowId = rest.slice(1).join('.');
    if (!table[rowId]) table[rowId] = {};
    table[rowId][col] = val;
  }
  return table;
}

async function pollSNMP(device) {
  const community = device.snmp_community || 'public';
  const port      = device.snmp_port || 161;
  const session   = createSession(device.ip_address, community, port);
  const errors    = [];
  const result    = { system: null, interfaces: [], cpu: [], memory: [], errors };

  try {
    const sys = await getOids(session, Object.values(OIDS));
    result.system = {
      sysDescr:    sys[OIDS.sysDescr],
      sysUptime:   sys[OIDS.sysUptime],
      sysContact:  sys[OIDS.sysContact],
      sysLocation: sys[OIDS.sysLocation],
    };
  } catch (err) {
    errors.push(`system: ${err.message}`);
  }

  try {
    const raw = await subtreeWalk(session, IF_ENTRY);
    const table = parseTable(raw, IF_ENTRY);
    result.interfaces = Object.entries(table).map(([idx, row]) => ({
      ifIndex:      idx,
      ifDescr:      row['2'] != null ? String(row['2']).trim() : null,
      ifOperStatus: row['8'] != null ? Number(row['8']) : null,
      ifInOctets:   row['10'] != null ? Number(row['10']) : null,
      ifOutOctets:  row['16'] != null ? Number(row['16']) : null,
    })).filter(i => i.ifDescr);
  } catch (err) {
    errors.push(`interfaces: ${err.message}`);
  }

  try {
    const raw = await subtreeWalk(session, CPU_ENTRY);
    const table = parseTable(raw, CPU_ENTRY);
    result.cpu = Object.values(table)
      .map(row => row['2'] != null ? Number(row['2']) : null)
      .filter(v => v != null && !isNaN(v));
  } catch (err) {
    errors.push(`cpu: ${err.message}`);
  }

  try {
    const raw = await subtreeWalk(session, MEM_ENTRY);
    const table = parseTable(raw, MEM_ENTRY);
    result.memory = Object.values(table).map(row => {
      const desc  = row['3'] ? String(row['3']).trim() : '';
      const units = Number(row['4']) || 1;
      const size  = Number(row['5']) || 0;
      const used  = Number(row['6']) || 0;
      return { desc, totalBytes: size * units, usedBytes: used * units };
    }).filter(m => m.desc && m.totalBytes > 0);
  } catch (err) {
    errors.push(`memory: ${err.message}`);
  }

  session.close();
  return result;
}

module.exports = { pollSNMP };
