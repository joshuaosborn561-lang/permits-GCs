import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { hasSupabase } from './lib/supabase.js';
import { runsRouter } from './routes/runs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    demoMode: config.demoMode,
    supabaseConfigured: hasSupabase(),
    openaiConfigured: Boolean(config.openaiApiKey),
    apifyConfigured: Boolean(config.apifyToken),
    getleadsConfigured: Boolean(config.getleadsApiKey),
    aiArkConfigured: Boolean(config.aiArkApiKey),
    leadmagicConfigured: Boolean(config.leadmagicApiKey),
  });
});

app.use('/api/runs', runsRouter);

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(config.port, () => {
  console.log(`Property PM Finder listening on :${config.port}`);
  console.log(
    `Mode: ${config.demoMode ? 'DEMO' : 'LIVE'} | Supabase: ${hasSupabase() ? 'yes' : 'no'} | OpenAI: ${config.openaiApiKey ? 'yes' : 'no'} | Apify: ${config.apifyToken ? 'yes' : 'no'}`,
  );
});
