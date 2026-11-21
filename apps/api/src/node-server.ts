import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { getDb, getDbMode } from './db/client.js';

const port = Number(process.env.PORT || 8787);
const app = createApp();

await getDb();
console.log(`[Kraya API] Bootstrapped DB (${getDbMode()}) — ZERO dummy data seeded.`);
console.log(`[Kraya API] Listening on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
