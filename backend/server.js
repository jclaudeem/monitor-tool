const express = require('express');
const path = require('path');
const { initDb } = require('./db/database');
const devicesRouter = require('./routes/devices');
const statusRouter = require('./routes/status');
const agentsRouter = require('./routes/agents');
const { startPoller } = require('./services/poller');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/devices', devicesRouter);
app.use('/api/status', statusRouter);
app.use('/api/agents', agentsRouter);

initDb();
startPoller();

app.listen(PORT, () => {
  console.log(`Monitor Tool running at http://localhost:${PORT}`);
});
