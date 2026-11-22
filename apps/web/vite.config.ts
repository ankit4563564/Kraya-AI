import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function krayaApiWatchdogPlugin(): Plugin {
  let apiChild: ChildProcess | null = null;
  let starting = false;

  async function isApiHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('http://127.0.0.1:8787/api/health', {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async function ensureApiRunning(): Promise<void> {
    if (starting) return;
    if (await isApiHealthy()) return;
    starting = true;
    try {
      const isWin = process.platform === 'win32';
      const tsxBin = path.resolve(repoRoot, `apps/api/node_modules/.bin/${isWin ? 'tsx.cmd' : 'tsx'}`);
      const entry = path.resolve(repoRoot, 'apps/api/src/node-server.ts');
      apiChild = spawn(tsxBin, [entry], {
        cwd: repoRoot,
        stdio: 'ignore',
        detached: true,
        shell: isWin,
        env: { ...process.env, PORT: '8787' },
      });
      apiChild.on('error', () => {
        // gracefully ignore spawn errors
      });
      apiChild.unref();
      // Wait up to 4s for API to bind
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (await isApiHealthy()) break;
      }
    } catch {
      // ignore spawn errors
    } finally {
      starting = false;
    }
  }

  return {
    name: 'kraya-api-watchdog',
    configureServer() {
      void ensureApiRunning();
      const interval = setInterval(() => {
        void ensureApiRunning();
      }, 5000);
      interval.unref();
    },
  };
}

export default defineConfig({
  plugins: [react(), krayaApiWatchdogPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
});

