const { app } = require('@azure/functions');
const { getPool } = require('../db');

// Runs daily at 03:00 UTC — deletes poll results older than 24 hours
app.timer('dailyCleanup', {
  schedule: '0 0 3 * * *',
  handler: async (myTimer, ctx) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        DELETE FROM poll_results
        WHERE polled_at < DATEADD(day, -1, GETUTCDATE())
      `);
      ctx.log(`Cleanup: removed ${result.rowsAffected[0]} old poll records`);
    } catch (err) {
      ctx.error('dailyCleanup:', err.message);
    }
  }
});
