# Self-hosted Pipecat deployment research

This note reflects the implemented architecture reviewed on 2026-10-27. No provider deployment API was called as part of the research.

## Pipecat framework and transport

Pipecat is an open-source Python framework for real-time voice agents, not a model or hosted service. The clinic agent uses Pipecat's FastAPI WebSocket transport with protobuf serialization and the Pipecat JavaScript client. It streams browser audio in both directions; it does not record audio for later upload. Gemini Live native audio is the default. Cartesia streaming TTS is an optional output path that uses Gemini text output and requires a Cartesia key and voice ID. Pipecat Cloud, SmallWebRTC and a custom WebRTC signaling server are not used.

The current Render agent process permits one active browser session at a time. This controlled WebSocket demo has not been load-tested and is not a production WebRTC, telephony, NAT-traversal or multi-client design.

## Render per-clinic deployment

The Node/Express management dashboard provisions one separate Render Web Service for each clinic, using the same private repository and `agent/` root directory. Each service receives its own tenant ID, provider variables and clinic context; credentials are sent to that clinic's Render environment and are not stored as plaintext in Supabase. The central dashboard alone holds the Render API key and Supabase secret key.

Render Free services may sleep and cold-start. The browser performs a visible bounded `/health` warm-up only after the user presses **Start browser test**. A 25-second application heartbeat runs only during a connected call and is cleared on every session exit. There is no idle pinger or scheduled keepalive; an instance restart can interrupt a call. Free-tier hosting is evaluation-only, not an always-on service guarantee.

The source still needs to be pushed to a private Git repository that Render can access. The dashboard service also needs protected production environment variables. Source presence and successful local checks do not establish that Render services have been created or deployed.

## Data and provider boundary

The dashboard server persists tenant configuration, integration status, deployment metadata, call logs and appointment lifecycle data in Supabase. A short-lived tenant-scoped signed bridge lets each agent read only its own clinic settings and write call/appointment metadata. Clinic agents do not receive the central Supabase key and do not persist audio, caller transcripts, caller identity or full conversation history. Appointment records can include attendee name and email.

Cal.com API v2 supports availability, booking, rescheduling and cancellation in the agent. Booking changes require browser approval. Rescheduling/cancellation check the supplied attendee email against the Cal.com booking; this is a basic match, not a clinic-approved identity-verification procedure. Browser escalation creates a call-log event only; there is no telephone transfer.

Twilio Account SID, Auth Token and E.164 number fields are visible in the admin UI but save configuration only. `TWILIO_ENABLED` remains false and no Twilio API, phone webhook, Media Streams transport, number provisioning or PSTN routing is implemented.

## Primary references

- [Pipecat WebSocket transport](https://docs.pipecat.ai/api-reference/server/services/transport/websocket-server)
- [Pipecat JavaScript WebSocket transport](https://docs.pipecat.ai/api-reference/client/js/transports/websocket)
- [Pipecat Gemini Live](https://docs.pipecat.ai/api-reference/server/services/s2s/gemini-live)
- [Pipecat Cartesia TTS](https://docs.pipecat.ai/api-reference/server/services/tts/cartesia)
- [Render Free](https://render.com/docs/free)
- [Render create service](https://api-docs.render.com/reference/create-service)
- [Render WebSockets](https://render.com/docs/websocket)
- [Cal.com API v2](https://cal.com/docs/api-reference/v2/introduction)

## Boundaries

Render Free, Gemini, Cartesia and Cal.com have independent limits and availability. The application is not healthcare-compliance certified; configure consent and retention policies and complete security/privacy review before any real patient use. Do not use real patient data for demo testing.
