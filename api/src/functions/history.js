const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');

app.http('deviceHistory', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'devicehistory/{id}',
  handler: async (req, ctx) => {
    const id = parseInt(req.params.id);
    if (!id) return { status: 400, jsonBody: { error: 'Invalid device id' } };

    const hours = Math.min(
      parseInt(new URL(req.url).searchParams.get('hours') || '24') || 24,
      168 // cap at 7 days
    );

    try {
      const pool = await getPool();

      const pingRows = await pool.request()
        .input('id',    sql.Int, id)
        .input('hours', sql.Int, hours)
        .query(`
          SELECT polled_at AS t, status, response_time AS ms
          FROM poll_results
          WHERE device_id = @id
            AND polled_at >= DATEADD(HOUR, -@hours, GETUTCDATE())
          ORDER BY polled_at ASC
        `);

      const snmpRows = await pool.request()
        .input('id',    sql.Int, id)
        .input('hours', sql.Int, hours)
        .query(`
          SELECT TOP 100 polled_at AS t, data
          FROM snmp_results
          WHERE device_id = @id
            AND polled_at >= DATEADD(HOUR, -@hours, GETUTCDATE())
          ORDER BY polled_at ASC
        `);

      const cpuHistory = [];
      const memoryHistory = [];

      for (const row of snmpRows.recordset) {
        let d;
        try { d = JSON.parse(row.data); } catch { continue; }
        if (d.cpu && d.cpu.length > 0) {
          cpuHistory.push({ t: row.t, values: d.cpu });
        }
        if (d.memory && d.memory.length > 0) {
          memoryHistory.push({
            t: row.t,
            entries: d.memory.map(m => ({
              desc: m.desc,
              pct: m.totalBytes > 0 ? Math.round(m.usedBytes / m.totalBytes * 100) : 0,
            })),
          });
        }
      }

      return {
        jsonBody: {
          ping: pingRows.recordset,
          cpu: cpuHistory,
          memory: memoryHistory,
        }
      };
    } catch (err) {
      ctx.error('deviceHistory:', err.message);
      return { status: 500, jsonBody: { error: 'Database error' } };
    }
  }
});
