#!/usr/bin/env bash
set -euo pipefail

echo "=== Kraya ₹0/Month Commercial-Safe Live Deploy (Cloudflare Workers + Pages + Neon) ==="
echo ""
echo "1. Verifying monorepo build & 36 binary QA tests..."
pnpm build
pnpm test

echo ""
echo "2. Deploying Backend API (apps/api) to Cloudflare Workers..."
echo "   Make sure you ran once:"
echo "     cd apps/api && npx wrangler login"
echo "     npx wrangler secret put DATABASE_URL      # Neon Serverless Postgres (1 GB free)"
echo "     npx wrangler secret put GEMINI_API_KEY    # Google AI Studio"
echo "     npx wrangler secret put ELEVENLABS_API_KEY # Your ElevenLabs Scribe + TTS"
echo "     npx wrangler secret put REQUIRE_AUTH      # Set 'true' for public multi-tenant launch"
(cd apps/api && npx wrangler deploy)

echo ""
echo "3. Deploying Frontend PWA (apps/web/dist) to Cloudflare Pages..."
echo "   Tip: Set VITE_API_BASE=https://kraya-api.<your-subdomain>.workers.dev before building."
npx wrangler pages deploy apps/web/dist --project-name kraya-workspace
