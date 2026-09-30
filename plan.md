# Implementation Plan — DentDesk Dental Receptionist Console

**Status:** The application and agent are implemented, the source is in a private GitHub repository, and both Supabase migrations are applied. The user completed the Render-to-GitHub connection. Render's latest create attempt requires billing information (HTTP 402), so no dashboard or clinic-agent service has been created. Do not describe the app as live or production-ready.

## Architecture and requested behavior

Use one management dashboard and one independent Render Web Service per clinic. Every clinic service runs the same Python/FastAPI agent code from the `agent/` subdirectory, but has its own `TENANT_ID`, Gemini/Cartesia/Cal.com provider environment, and clinic receptionist settings. The dashboard's server-side Render API integration creates and tracks those services; it does not clone separate source code for every clinic. Pipecat is the open-source Python framework, not Pipecat Cloud, and needs no Pipecat Cloud account or key.

The dashboard requires a protected passcode login. It has clinic creation, clinic settings, integration updates, deployment status, recent calls, usage counts and a browser voice tester. Clinic provider secrets are entered into password fields, sent server-to-server to that clinic's Render environment, and never returned to the browser or saved as plaintext in Supabase. Supabase keeps clinic configuration and integration-status metadata. The central dashboard alone receives the Supabase secret key.

Each agent receives no Supabase key. It uses a tenant-specific short-lived HS256 bridge token to request only its clinic's configuration and write metadata-only call/appointment events. The dashboard checks signature, purpose and tenant scope before data access. Agents do not persist raw audio, transcripts, caller identity or full conversation history. The browser displays a live transcript in memory during the test; it is not persisted as transcript history.

## Audio, receptionist and scheduling

Use the open-source Pipecat FastAPI WebSocket transport and Pipecat JavaScript client for bidirectional live microphone/audio frames. Do not record audio for later upload. Ask for microphone permission after an explicit **Start browser test** action. Render Free services may sleep; only that user action starts a bounded, visible `/health` wake-up loop. There is no background idle pinger. A 25-second application heartbeat runs only while the browser voice session is connected and is cleared on stop, error, disconnect and unmount. The service allows one active browser session per clinic process in this demo.

Gemini Live native speech is the default low-latency response mode. A clinic can select Cartesia streaming TTS and a Cartesia voice ID. That mode asks Gemini Live for text output; supported modalities vary by model. If the chosen model cannot return text, the session shows an error instead of silently changing voice modes. Render's browser WebSocket path is suitable for this controlled demo, not a promise of production WebRTC, load capacity or always-on availability.

The assistant can answer from the clinic greeting, free-text clinic reference information and structured FAQs. There is no document-upload parser, embeddings pipeline or vector database. Cal.com API v2 provides availability lookup and appointment booking, rescheduling and cancellation. Availability lookup is read-only. Any booking change waits for browser approval of the exact proposed action. Rescheduling/cancellation require the supplied attendee email to match the existing Cal.com booking; this is only a basic check, not a clinic-approved identity-verification policy. A human handoff is a browser escalation event and call-log flag only; no call is transferred.

## Provider fields and clinic operations

The GUI accepts Gemini and Cartesia API keys, Cartesia voice ID, Cal.com API key and a numeric event type ID or an event slug plus exactly one owner username/team slug. It offers optional Twilio Account SID, Auth Token and E.164 phone fields. Twilio values may be saved to the clinic Render environment, but `TWILIO_ENABLED` stays `false`; there are no Twilio API calls, webhooks, number configuration or phone routing. The integration is labeled not connected.

Show configured/not-configured integration state without displaying stored secret values. Show Render build/deploy state and service URL when available, plus call count, talk time, bookings and escalation count from app records. Support per-clinic credential/configuration updates, manual redeploy, and confirmed Render-agent deletion while preserving clinic history. Do not claim pause/resume controls or automatic stopping; Render Free's own sleep behavior is separate from this lifecycle UI.

The Render API creates one Free Python web service per clinic from the configured private repository and `agent/` root directory. The management portal itself is a separate Node service. `RENDER_REPO_URL`, branch, region and owner settings are protected dashboard-host configuration. Render Free is demo-only; cold starts and restarts can interrupt calls. No uptime scheduler or external ping job is part of the system.

## Authentication and configuration

Keep `DASHBOARD_ADMIN_PASSCODE`, a stable 32-byte `DASHBOARD_SESSION_SECRET`, `RENDER_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the dashboard server only. Set `APP_PUBLIC_URL` to the dashboard HTTPS origin in a hosted deployment. Secure session cookies are HTTP-only and use `SameSite=None; Secure` for HTTPS Preview/hosting; local HTTP uses `SameSite=Lax`. Mutating dashboard API requests require a trusted Origin. Login is rate-limited and logout clears the session cookie.

The clinic agent receives only its provider keys, clinic UUID, dashboard origin and tenant-derived signing key. It receives no central Supabase secret. Do not log bearer tokens or provider exception text. Twilio remains disabled even when its credential fields have values.

## Project structure

- `src/client/`: admin login, clinic inventory, clinic settings/FAQs, provider credential forms, deployment/usage panels, call activity, and live Pipecat browser tester.
- `src/server/auth/`: passcode session, trusted-origin guard and authorization.
- `src/server/routes/api.ts`: clinic management, Render lifecycle, tenant-scoped signed agent bridge, and voice-token issuance.
- `src/server/integrations/render.ts`: server-only Render API calls for clinic service creation, environment-variable updates, status, redeploy and removal.
- `src/server/integrations/supabase.ts`: clinic, call, appointment and usage persistence.
- `agent/`: Python/FastAPI Pipecat service, Gemini Live tools, optional Cartesia TTS, Cal.com API v2 adapter, and signed dashboard bridge client.
- `supabase/migrations/`: initial clinic/auth/data schema (with a separate `receptionist_appointments` table so the legacy table remains untouched) and additive Render-service metadata schema.
- `docs/`: provider/source research and operating limits.

## Visual design

Three less-common directions considered: clinical editorial (**0.04**), dark industrial operations instrumentation (**0.07**), and warm craft-studio console (**0.03**). Choose **dark industrial operations instrumentation** for the shared control room.

- **Design movement:** Contemporary control-room instrumentation, translated into a clear admin surface rather than a dense monitoring wall.
- **Core principles:** Operational clarity; clinic boundaries always visible; credentials never visually exposed; deployment states are honest.
- **Color philosophy:** Graphite is a quiet foundation; mint indicates healthy/ready; amber indicates waking/pending; red is reserved for errors and destructive actions.
- **Layout paradigm:** Narrow persistent side rail, main operations workspace, and contextual clinic deployment pane.
- **Signature elements:** Deployment-state rails, compact service metadata and a waveform indicator only during a live test.
- **Interaction philosophy:** Actions show progress; saved secrets show configured/update state without revealing values; deletion requires a distinct confirmation.
- **Animation:** Short status transitions and a restrained live waveform; honor reduced-motion settings.
- **Typography:** IBM Plex Sans for UI and IBM Plex Mono for service IDs and technical metadata.
- **Brand essence:** A control room for multi-clinic voice reception; precise, calm and accountable.
- **Brand voice:** Direct and status-oriented. Examples: “Clinic agent is ready to accept sessions.” “The free service is waking; this can take a short while.”
- **Wordmark & logo:** Compact dental-cross/voice-wave mark paired with a custom wordmark.
- **Signature brand color:** Cool mint/teal, reserved for verified readiness.

## Delivery boundary

The project has local source and passing build/import checks, and its Supabase schema is live. The remaining external step is authorizing Render's GitHub connection to read the private repository. Then create the dashboard service, create a demo clinic through the dashboard, confirm provider responses, and perform a real browser voice test. Do not use real patient data or claim healthcare compliance or production readiness without independent review.
