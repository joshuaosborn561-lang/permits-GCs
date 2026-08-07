import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountMcpHttp } from '../mcp/http.js';
import { config } from './config.js';
import { hasSupabase } from './lib/supabase.js';
import { runsRouter } from './routes/runs.js';
import { shovelsContractorsRouter } from './routes/shovelsContractors.js';
import { loadShovelsContractors } from './services/shovelsContractors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    demoMode: config.demoMode,
    openaiModel: config.openaiModel,
    loopnetMode: config.loopnetMode,
    loopnetBatchSize: config.loopnetBatchSize,
    loopnetIncludeDetails: config.loopnetIncludeDetails,
    supabaseConfigured: hasSupabase(),
    openaiConfigured: Boolean(config.openaiApiKey),
    apifyConfigured: Boolean(config.apifyToken),
    getleadsConfigured: Boolean(config.getleadsApiKey),
    aiArkConfigured: Boolean(config.aiArkApiKey),
    leadmagicConfigured: Boolean(config.leadmagicApiKey),
    shovelsContractorsLoaded: loadShovelsContractors().length,
    mcp: {
      streamableHttp: '/mcp',
      health: '/mcp/health',
      stdio: 'node dist/mcp/stdio.js',
    },
  });
});

app.use('/api/runs', runsRouter);
app.use('/api/shovels/contractors', shovelsContractorsRouter);
mountMcpHttp(app);

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/mcp')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(config.port, () => {
  const contractors = loadShovelsContractors();
  console.log(`Property PM Finder listening on :${config.port}`);
  console.log(`MCP streamable HTTP: /mcp  |  stdio: node dist/mcp/stdio.js`);
  console.log(
    `Mode: ${config.demoMode ? 'DEMO' : 'LIVE'} | Supabase: ${hasSupabase() ? 'yes' : 'no'} | OpenAI: ${config.openaiApiKey ? 'yes' : 'no'} | Apify: ${config.apifyToken ? 'yes' : 'no'} | Shovels contractors: ${contractors.length}`,
  );
});
