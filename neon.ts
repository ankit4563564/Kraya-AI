import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: true,
  },
  auth: true,
  aiGateway: true,
  functions: {
    hello: { name: "Kraya Compute & Morning Sweep", source: "./hello.ts" },
  },
  triggers: {
    "kraya-morning-sweep": {
      type: "schedule",
      function: "hello",
      cron: "30 2 * * *",
      functionPath: "/cron",
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      return { ttl: "7d" };
    }
    return {};
  },
});
