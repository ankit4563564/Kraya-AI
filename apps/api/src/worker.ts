import { createApp, AppEnv } from './app.js';

export default {
  fetch(request: Request, env: AppEnv, ctx: unknown) {
    const app = createApp(env);
    return app.fetch(request, env as never, ctx as never);
  },
};
