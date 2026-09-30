# DentDesk Dental Receptionist Console

A passcode-protected management dashboard for creating and managing one independent open-source Pipecat service per clinic. The browser tester streams microphone audio in real time over a Pipecat WebSocket; Gemini Live native speech is the default. Cartesia streaming TTS is an optional clinic setting. Cal.com API v2 is used for scheduling actions. This is a non-production demo, not a healthcare-compliance certification.

## What the application does

The dashboard uses the Render API to create, inspect, redeploy, and remove a separate Python/Pipecat Free Web Service for each clinic. Each service runs the same agent source with its own tenant ID, provider environment, and clinic-specific settings. A clinic's provider keys are sent from the dashboard server to that clinic's Render environment. The browser never receives saved key values, and Supabase stores only configuration and integration-status metadata—not provider secrets.

Clinic settings include an opening greeting, reference/knowledge text, structured FAQs, time zone, Cal.com selector, Cartesia voice ID, and speech-output mode. This starter does not parse uploaded documents or implement embeddings/vector search. The dashboard shows integration state, service/deploy status, recent browser calls, and app-level usage such as call duration, bookings, and escalations; it does not report provider billing.

Twilio fields accept Account SID, Auth Token, and an E.164 phone number. Values may be saved to the clinic Render environment, but `TWILIO_ENABLED` remains `false`: the app makes no Twilio API calls, creates no phone webhook, provisions no number, and does not route phone calls. A browser-test handoff is a logged escalation event, not a phone transfer.

## Render Free behavior and limits

Render Free services can sleep after inactivity, and the first request may wait for a cold start. The voice tester runs a visible, bounded `/health` wake-up only after the user presses **Start browser test**. There is no background uptime pinger or scheduled keepalive. A 25-second application heartbeat runs only while the browser call is connected; a Render restart can still disconnect the call. The dashboard itself can also have a cold start if hosted on Render Free.

Pipecat is the open-source Python framework; it does not require Pipecat Cloud or a Pipecat API key. Gemini, Cartesia, Cal.com, Supabase and Render each have separate credentials and usage policies. Render Free is suitable only for this evaluation demo. The browser WebSocket transport is not load-tested production telephony/WebRTC and the initial agent process permits one active browser session at a time.

## Prerequisites

- Node.js 22+ and pnpm 11.25.0 for the dashboard; Python 3.11+ for the agent.
- A Supabase project and permission to apply its schema migrations.
- A Render account/API key and a private Git repository that Render can access. The repository must contain both the dashboard and `agent/` directory.
- A Gemini API key for voice conversation. Cartesia API key and voice ID are needed to use Cartesia mode. Cal.com API key and an event selector are needed for scheduling.

The Render API key can create services and set their environment variables. Keep it in protected server configuration only. Do not place it in browser code, Supabase, `.env.example`, or source control. The project does not need a separate generated “copy key”: the dashboard uses the Render API key server-side to provision each service.

## Local dashboard setup

1. Copy `.env.example` to an untracked `.env`. Set local values for `DASHBOARD_ADMIN_PASSCODE`, `DASHBOARD_SESSION_SECRET`, `APP_PUBLIC_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and any optional Render/provider defaults. For the stable session secret use 64 hexadecimal characters generated from 32 cryptographically random bytes. Do not commit `.env`.
2. Install dependencies and run the development dashboard:

   ```bash
   pnpm install --frozen-lockfile
   pnpm dev
   ```

   The Vite client listens on `http://localhost:3000`; the Express API listens on port `3001`. Use `pnpm build` for the production client build. The local browser API requests use same-origin relative paths.

## Deploy the dashboard to Render

The source for this project is in a **private** GitHub repository. Render must be authorized to read it; do not make the repository public. Set `RENDER_REPO_URL` to `https://github.com/owner/repository` without a trailing `.git` suffix and set the branch separately. Create a Node Web Service from the repository root with the Free plan for this demo and these commands:

This is a one-time account connection: sign in to Render, open [Account Security](https://dashboard.render.com/u/settings#account-security), choose **Add credential** under **Git Deployment Credentials**, and connect GitHub. When asked which repositories Render can access, select only `rahil565665-afk/dentdesk` if that option is available. A Render API key can manage Render resources, but it does not grant Render permission to clone a private GitHub repository.

```text
Build: corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build && pnpm prune --prod
Start: pnpm start
```

Set the protected dashboard service environment variables from `.env.example`. At minimum the hosted dashboard needs `DASHBOARD_ADMIN_PASSCODE`, a stable 64-hex `DASHBOARD_SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `RENDER_API_KEY`. Set `APP_PUBLIC_URL` to the exact public HTTPS origin once Render assigns it. To enable clinic service creation, also set `RENDER_REPO_URL` to the private repository URL, `RENDER_BRANCH`, and an allowed `RENDER_REGION`; optionally specify `RENDER_OWNER_ID` if the Render key can access more than one workspace. Provider defaults in the dashboard environment are optional—the clinic GUI can receive each clinic's keys directly.

On 2026-10-28, the Render API returned HTTP 402 saying payment information is required before it can create the dashboard service. No service was created. The account owner must review Render's billing page and add payment details if they choose to proceed; keep the selected service plan set to Free and review any billing terms before confirming. Do not send payment details in chat.

The management server must retain its Render API key, Supabase secret and passcode outside source control. Never store them in a SQL migration, seed file, browser bundle, build argument, or public repository. The Dashboard starts without the external service setup, but Render provisioning requires a reachable private repository and valid Render workspace configuration.

## Run the Pipecat agent locally

From `agent/`, create an isolated environment and install the pinned packages:

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill local-only values for `TENANT_ID`, `GEMINI_API_KEY`, `DASHBOARD_ORIGIN`, and `VOICE_TOKEN_SIGNING_SECRET`. For a local agent authorized by the local dashboard, derive the 64-hex per-tenant signing secret from the same 64-hex `DASHBOARD_SESSION_SECRET` and tenant UUID:

The Python service does not load `.env` files automatically. Load the dashboard's root `.env` (for the shared session secret) and then `agent/.env` into your shell before deriving the signing key and starting the agent:

```bash
set -a
. ../.env
. ./.env
set +a
```

```bash
export TENANT_ID=00000000-0000-4000-8000-000000000001
export VOICE_TOKEN_SIGNING_SECRET="$(node --input-type=module -e "import {hkdfSync} from 'node:crypto'; const tenant=process.env.TENANT_ID; console.log(Buffer.from(hkdfSync('sha256', Buffer.from(process.env.DASHBOARD_SESSION_SECRET, 'hex'), Buffer.from('dentdesk-voice:'+tenant), Buffer.from('dentdesk-voice-session-v1'), 32)).toString('hex'))")"
```

Set `CARTESIA_API_KEY` if the clinic selects Cartesia mode and `CALCOM_API_KEY` plus a valid event selector to enable scheduling. The service honors Render's `PORT` and defaults to `10000`. Its `/health` route is an unauthenticated liveness check; `/ws` requires the dashboard's short-lived tenant-scoped voice token and the exact configured dashboard origin. Never commit `.env` or signing keys.

## Supabase migrations

Review and apply these files in order to the intended Supabase project:

1. `supabase/migrations/202610260001_initial_schema.sql`
2. `supabase/migrations/202610270002_render_agents.sql`

The configured Supabase project already contains an older, empty `public.appointments` table linked to a `clients` table. These migrations leave both legacy tables untouched; the receptionist application writes bookings to the separate `public.receptionist_appointments` table.

They are not automatically applied by the application. Back up and inspect the target project before running schema changes if it already contains data. The dashboard uses the Supabase secret key server-side and checks tenant ownership. Clinic agents do not receive the Supabase key; each uses a short-lived signed dashboard bridge to fetch only its assigned clinic's configuration and write call/appointment lifecycle metadata.

The agent does not store raw audio, caller transcripts, caller identity, or full conversation history. The live transcript is displayed in the browser session only. Appointment records may include attendee name and email, and call logs include session metadata. Audio is streamed to the configured voice/AI provider and appointment actions are sent to Cal.com. Establish consent, retention and privacy controls before any real use; do not test with real patient data.

## Voice and appointment behavior

- **Gemini Live native speech** is the default real-time mode.
- **Cartesia streaming TTS** uses a configured voice ID and Gemini Live text output. Support varies by Gemini model; if the selected model cannot provide text output, the voice session reports an error instead of silently switching modes.
- Availability lookup is read-only. Booking, rescheduling and cancellation require browser approval of the exact proposed change. Rescheduling/cancellation also require the supplied attendee email to match the existing Cal.com booking. This is a basic match only, not a clinic-approved identity-verification procedure.
- Human escalation creates a browser event and call-log flag only. No telephone transfer occurs.
- Cal.com scheduling needs either a numeric event type ID or an event slug plus exactly one owner username or team slug. If the key or selector is missing, scheduling tools are unavailable.

## Project structure

- `src/client/` — passcode sign-in, clinic console, settings, integration forms, call activity, and live voice tester.
- `src/server/` — dashboard API, session protection, Render provisioning, Supabase repositories, and tenant-scoped agent bridge.
- `agent/` — isolated Python Pipecat service, Gemini Live tools, optional Cartesia mode, Cal.com adapter, and signed dashboard bridge client.
- `supabase/migrations/` — initial schema and additive Render service metadata migration.
- `docs/` — provider research and architecture constraints.

## References

- [Pipecat FastAPI WebSocket server transport](https://docs.pipecat.ai/api-reference/server/services/transport/websocket-server)
- [Pipecat JavaScript WebSocket transport](https://docs.pipecat.ai/api-reference/client/js/transports/websocket)
- [Pipecat Gemini Live](https://docs.pipecat.ai/api-reference/server/services/s2s/gemini-live)
- [Pipecat Cartesia TTS](https://docs.pipecat.ai/api-reference/server/services/tts/cartesia)
- [Render Free services](https://render.com/docs/free)
- [Render API: create service](https://api-docs.render.com/reference/create-service)
- [Cal.com API v2](https://cal.com/docs/api-reference/v2/introduction)
