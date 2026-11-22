import { neon } from "@neondatabase/serverless";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. Live Lakebase Postgres status inside Neon Function compute (ap-southeast-1)
    if (url.pathname === "/status" && request.method === "GET") {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        return Response.json({ ok: false, error: "DATABASE_URL not injected" }, { status: 500 });
      }
      const sql = neon(dbUrl);
      const rows = await sql`
        SELECT
          current_database() AS database,
          (SELECT count(*)::int FROM workspaces) AS workspaces_count,
          (SELECT count(*)::int FROM suppliers) AS suppliers_count,
          (SELECT count(*)::int FROM agent_runs) AS agent_runs_count
      `;
      return Response.json({
        ok: true,
        runtime: "neon-functions-nodejs24",
        branch: process.env.NEON_BRANCH || "production",
        branchId: process.env.NEON_BRANCH_ID || null,
        stats: rows[0] ?? {},
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Scheduled Morning Procurement Sweep Trigger (08:00 AM IST / 02:30 UTC)
    if (url.pathname === "/cron" && request.method === "POST") {
      const headerId = request.headers.get("x-neon-trigger-invocation-id");
      const body = (await request.json().catch(() => null)) as {
        invocation_id?: string;
        trigger?: { name?: string; type?: string };
        data?: { scheduled_at?: string };
      } | null;

      if (!headerId || !body?.invocation_id || headerId !== body.invocation_id) {
        return Response.json({ ok: false, error: "Unauthorized trigger invocation" }, { status: 401 });
      }

      const dbUrl = process.env.DATABASE_URL;
      let workspacesSwept = 0;
      if (dbUrl) {
        const sql = neon(dbUrl);
        const wsRows = await sql`SELECT id FROM workspaces LIMIT 50`;
        workspacesSwept = wsRows.length;
      }

      return Response.json({
        ok: true,
        trigger: body.trigger?.name || "kraya-morning-sweep",
        invocationId: body.invocation_id,
        scheduledAt: body.data?.scheduled_at || new Date().toISOString(),
        workspacesSwept,
      });
    }

    return new Response("Hello from Neon Functions — Kraya Cloud Compute Ready");
  },
};
