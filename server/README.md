# Scobe hosted AI

This gateway supplies Claude chat and ElevenLabs speech to signed-in Scobe users. Provider keys stay on the server. The desktop keeps only an encrypted user session. The owner's local provider-key setup remains available while the gateway URL is blank.

## Deployment checklist

1. Create a Supabase project. Enable email authentication and configure production SMTP. In Authentication > Email Templates > Magic Link, use the email code template containing {{ .Token }} rather than a link. Configure OTP expiry and Supabase's email/auth rate limits. No password is collected by Scobe.
2. Run server/schema.sql in the Supabase SQL editor. It creates private usage records and an atomic service-role-only reservation function. Do not expose the service-role key in the app.
3. Connect the repository to Render and create a Blueprint from render.yaml. Choose the hosting plan explicitly in Render. A long-running Node service is required for streaming; this is separate from the static marketing site.
4. Add the seven required secret settings shown in server/settings.example to the server's environment. Copy your Anthropic key and working ElevenLabs key directly into the host's secret settings. Select approved ElevenLabs voice IDs; users will only see these voices. Give the ElevenLabs key Voices read and Text to Speech access.
5. Set per-user and overall usage limits appropriate for your beta. The defaults reserve 200,000 chat units/user/day and 2,000,000 overall; 15,000 speech characters/user/day and 100,000 overall. Chat units conservatively reserve UTF-8 request bytes plus maximum output tokens, multiplied by 5 for Opus. These are application limits, not dollar budgets. Set provider billing alerts/spend limits too. Failed or cancelled calls do not refund reservations.
6. Confirm /health returns ok and /config returns only public Supabase configuration. Verify an anonymous chat request fails with 401 and an exhausted allowance fails with 429. Apply database retention with a scheduled cleanup if desired (example in schema.sql).
7. Set gatewayUrl in src/shared/cloudConfig.json to the deployed HTTPS gateway address, then build Scobe. That public address is the only hosted-AI configuration shipped with the app. Public packaging commands now stop if it is missing.
8. On a clean device: sign in using an email code, send a Claude request, select each supported model, choose a voice, read aloud, restart to check session persistence, and sign out. Verify the release archive contains no .env, provider keys, Supabase service role key, or owner session files.

## Local checks

Run npm run test:gateway from the repository root. The tests use fake auth/database/provider responses and make no paid API calls. Both desktop TypeScript projects should pass, followed by npm run build.

Database concurrency, email delivery, provider model access, hosted streaming timeouts, and actual speech playback require staging checks after the services exist. The backend has not been deployed merely by adding these files.

## Operational notes

All users can create an account by verifying their email; there is no paid-plan system yet. Email sign-in alone does not prevent determined multi-account abuse. Use provider spend caps, configure Supabase signup protection, and add paid entitlements or an invitation allowlist before a broad paid launch. Request quotas are shared across replicas through Postgres, not process-local memory. Unknown routes, arbitrary voice IDs, non-approved models, and excess output requests are rejected. AI prompts are forwarded to the selected provider and are not persisted by this gateway.
