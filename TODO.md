# TODO — DentDesk Dental Receptionist Console

## 1. Passcode-protected dashboard and clinic management

- [x] Provide an administrator GUI protected by a passcode from server configuration. It includes clinic creation, clinic settings, provider configuration, call activity, deployment status and usage information. Sign-in is rate-limited, sessions are signed and HTTP-only, and mutating browser requests are restricted to a trusted Origin.
- [x] Let an administrator create separate Render-hosted clinic agents from the dashboard GUI. Each clinic gets an independent Python/FastAPI Pipecat service with its own tenant ID and provider environment; the services use the same source rather than cloned repositories.
- [x] Display each clinic's service URL when available, Render/deploy status, configured/not-configured integration metadata, recent browser calls, call duration, booking count and escalation count. Saved secret values are never displayed again. Support credential/configuration updates, manual redeployment and confirmed deletion that preserves Supabase clinic history.
- [x] Put the project source, including the dashboard and `agent/` directory, in a private GitHub repository. Do not publish the source publicly.
- [ ] Deploy the dashboard Node service from that repository with the build/start commands and protected environment variables, including its public HTTPS origin, stable session secret, Render API key and central Supabase configuration.

## 2. Clinic configuration, tenant isolation and data

- [x] Let the administrator configure the clinic greeting, time zone, free-text reference/knowledge base, structured FAQs, speech-output mode, Cal.com selector and provider credentials through the GUI. The current implementation supports text and FAQs; it does not upload documents, parse files, create embeddings or perform vector retrieval.
- [x] Provide SQL migrations for clinic records, Render service metadata, integration-status metadata, call logs, receptionist appointments and tenant-aware database access. Keep the existing legacy `public.appointments` table untouched. The dashboard holds the central Supabase secret key server-side; agent services receive no Supabase secret key.
- [x] Let each Pipecat agent fetch only its own clinic's settings and write call/appointment lifecycle metadata through a short-lived tenant-signed dashboard bridge. Agents do not persist raw audio, live transcript text, caller identity or full conversation history. The browser shows a live transcript only in session memory; appointment records may contain attendee name/email.
- [x] Apply both migrations to the Supabase project matched to the app configuration. Preserve its existing empty legacy `public.appointments` table and write receptionist bookings to `public.receptionist_appointments`.

## 3. Real-time open-source Pipecat browser voice tester

- [x] Use the open-source Python Pipecat framework, not Pipecat Cloud. Stream microphone input and assistant audio in real time over the Pipecat protobuf WebSocket transport; do not record audio for later upload. Ask for microphone access only after the user starts a browser test.
- [x] Default to Gemini Live native speech. Offer optional Cartesia streaming TTS with a configured voice ID, using Gemini Live text output; show an error if the selected Gemini model does not support that response modality rather than silently changing modes.
- [x] Show user-initiated Render Free wake progress, connection/listening/processing/speaking/error/disconnect/escalation states and a live transcript. A bounded health check starts only after **Start browser test**. A 25-second application heartbeat runs only during an active connection and is cleared at session end; there is no background pinger, external cron or idle keepalive.
- [x] Limit this demo to one active browser session per clinic agent process and disclose that its WebSocket path is a controlled demo, not production-grade WebRTC, load-tested scaling or always-on service.
- [x] Record a browser escalation request when the caller asks for a person. This is a dashboard/call-log event only; it does not transfer to a telephone number.

## 4. Cal.com scheduling and save-only Twilio fields

- [x] Integrate Cal.com API v2 availability lookup, booking, rescheduling and cancellation. Support a numeric event type ID or an event slug paired with exactly one owner username or team slug.
- [x] Require browser approval for the exact booking/rescheduling/cancellation action before making a change. Require the attendee email to match before rescheduling or canceling an existing booking; this is a basic check, not a clinic-approved identity-verification process.
- [x] Show Twilio Account SID, Auth Token and E.164 phone-number fields labeled not connected. Saving values stores them in the clinic Render environment, keeps `TWILIO_ENABLED=false`, and does not call Twilio, configure a number or webhook, route a phone call, or create a telephony integration.

## 5. Remaining live handoff

- [x] Connect Render to GitHub and authorize access to the private `rahil565665-afk/dentdesk` repository. This one-time Git-provider authorization is separate from the Render API key.
- [ ] Add billing information in the Render account if required, then deploy the dashboard Node service on the selected Free plan with its protected production environment. Render returned HTTP 402 before creating any service; review Render's billing terms before confirming any payment method.
- [ ] Deploy the management dashboard and create a clinic agent from its GUI. Verify actual Render build/runtime state rather than relying on local checks.
- [ ] Configure provider credentials in the GUI. Verify Gemini Live, optional Cartesia and Cal.com against the actual providers.
- [ ] Complete an end-to-end browser conversation and appointment-flow check after deployment. Do not claim the system is live until the services are healthy and a real audio conversation succeeds.
- [x] Document Render Free cold starts, no background keepalive, audio/data boundaries and the absence of healthcare-compliance or production-readiness claims. Do not test with real patient data.
