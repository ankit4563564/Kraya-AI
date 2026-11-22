import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { getDb, getDbMode } from './db/client.js';

// Load both local apps/api/.env and monorepo root .env cleanly
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('[Kraya API UncaughtException]', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Kraya API UnhandledRejection]', reason);
});

const port = Number(process.env.PORT || 8787);
const app = createApp();

await getDb();
console.log(`[Kraya API] Bootstrapped DB (${getDbMode()}) — ZERO dummy data seeded.`);
console.log(`[Kraya API] Listening on http://localhost:${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Kraya API] Port ${port} is already bound by an active Kraya API instance.`);
    process.exit(0);
  }
  console.error('[Kraya API Server Error]', err);
});

