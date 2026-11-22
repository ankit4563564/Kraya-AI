import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';

describe('Integration Control Center & Real Service Verification', () => {
  const app = createApp({
    REQUIRE_AUTH: 'false',
    NODE_ENV: 'development',
  });

  it('GET /api/integrations returns evidence-based status for all 11 external services', async () => {
    const res = await app.request('/api/integrations');
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      summary: {
        total: number;
        connected: number;
        fallbackActive: number;
        notConfigured: number;
        unverified: number;
        error: number;
      };
      integrations: Array<{
        id: string;
        name: string;
        category: string;
        status: string;
        providerMode: string;
        isConfigured: boolean;
        requiredEnvVars: string[];
        supportedOperations: string[];
        setupGuide: { description: string; sampleEnv: string };
      }>;
    };

    expect(data.ok).toBe(true);
    expect(data.summary.total).toBe(12);
    expect(data.integrations).toHaveLength(12);

    const ids = data.integrations.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'neon',
        'r2',
        'gemini',
        'whatsapp',
        'resend',
        'gmail',
        'groq',
        'elevenlabs',
        'razorpayx',
        'tally',
        'zoho',
        'gstn',
      ])
    );

    // Verify Neon in local dev correctly reports FALLBACK_ACTIVE on PGlite WASM
    const neonCard = data.integrations.find((i) => i.id === 'neon');
    expect(neonCard?.status).toBe('FALLBACK_ACTIVE');
    expect(neonCard?.providerMode).toBe('pglite-local-wasm');
    expect(neonCard?.supportedOperations.length).toBeGreaterThan(3);

    // Verify R2 in local dev correctly reports FALLBACK_ACTIVE on local disk vault
    const r2Card = data.integrations.find((i) => i.id === 'r2');
    expect(r2Card?.status).toBe('FALLBACK_ACTIVE');
    expect(r2Card?.providerMode).toBe('local_dev_vault');

    // Verify unconfigured services report NOT_CONFIGURED
    const waCard = data.integrations.find((i) => i.id === 'whatsapp');
    expect(waCard?.status).toBe('NOT_CONFIGURED');
    expect(waCard?.requiredEnvVars).toContain('WHATSAPP_ACCESS_TOKEN');

    // Security check: ensure no secrets are exposed in response
    const rawJson = JSON.stringify(data);
    expect(rawJson).not.toContain('password');
    expect(rawJson).not.toContain('AIzaSy');
  });

  it('POST /api/integrations/test/neon executes real DB queries and ACID transaction probes', async () => {
    const res = await app.request('/api/integrations/test/neon', { method: 'POST' });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      service: string;
      status: string;
      providerMode: string;
      latencyMs: number;
      details: {
        dbMode: string;
        pgVersion: string;
        database: string;
        publicTablesCount: number;
        transactionTest: string;
      };
      testedAt: string;
    };

    expect(data.ok).toBe(true);
    expect(data.service).toBe('neon');
    expect(data.status).toBe('FALLBACK_ACTIVE');
    expect(data.latencyMs).toBeGreaterThan(0);
    expect(data.details.transactionTest).toContain('PASSED');
    expect(data.details.publicTablesCount).toBeGreaterThan(15);
  });

  it('POST /api/integrations/test/r2 executes real write-read-delete round-trip probes', async () => {
    const res = await app.request('/api/integrations/test/r2', { method: 'POST' });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      service: string;
      status: string;
      providerMode: string;
      latencyMs: number;
      details: {
        storageMode: string;
        probeRoundtrip: string;
      };
      testedAt: string;
    };

    expect(data.ok).toBe(true);
    expect(data.service).toBe('r2');
    expect(data.status).toBe('FALLBACK_ACTIVE');
    expect(data.details.probeRoundtrip).toContain('PASSED');
    expect(data.latencyMs).toBeGreaterThan(0);
  });

  it('POST /api/integrations/test-all runs a comprehensive diagnostic sweep across all services', async () => {
    const res = await app.request('/api/integrations/test-all', { method: 'POST' });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      sweptAt: string;
      results: Record<string, { ok: boolean; status?: string }>;
    };

    expect(data.ok).toBe(true);
    expect(data.results.neon?.ok).toBe(true);
    expect(data.results.r2?.ok).toBe(true);
    expect(data.results.gemini?.ok).toBe(true);
  });

  it('GET /api/integrations persists test results and updates status dynamically', async () => {
    // After running tests, GET /api/integrations should show lastTestedAt and latencyMs
    const res = await app.request('/api/integrations');
    const data = (await res.json()) as {
      integrations: Array<{ id: string; lastTestedAt: string | null; latencyMs: number | null }>;
    };

    const neon = data.integrations.find((i) => i.id === 'neon');
    expect(neon?.lastTestedAt).not.toBeNull();
    expect(neon?.latencyMs).toBeGreaterThan(0);

    const r2 = data.integrations.find((i) => i.id === 'r2');
    expect(r2?.lastTestedAt).not.toBeNull();
    expect(r2?.latencyMs).toBeGreaterThan(0);
  });
});
