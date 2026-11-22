import { createApp, AppEnv } from './app.js';
import { runAutonomousSweepAllWorkspaces } from './routes-agents.js';

export default {
  fetch(request: Request, env: AppEnv, ctx: unknown) {
    const app = createApp(env);
    return app.fetch(request, env as never, ctx as never);
  },

  /**
   * Cloudflare Workers Cron Trigger (wrangler.toml: "30 2 * * *" = Daily 08:00 AM IST).
   * Runs the Autonomous Procurement Operations Agent across all active workspaces.
   */
  async scheduled(
    _event: { scheduledTime: number; cron: string },
    env: AppEnv,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ) {
    const sweepPromise = runAutonomousSweepAllWorkspaces(env).then((summary) => {
      console.log(
        `[Kraya Morning Cron] Swept ${summary.workspacesSwept} workspace(s), created ${summary.totalTasksCreated} task(s).`
      );
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(sweepPromise);
    } else {
      await sweepPromise;
    }
  },
};
