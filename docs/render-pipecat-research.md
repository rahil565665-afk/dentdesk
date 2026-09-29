# Render + Pipecat Free demo notes

Verified from official provider documentation on 2026-10-27. The selected architecture is one separate Render Free service per clinic, open-source Pipecat, and real-time browser audio. Twilio is optional settings only and remains disconnected. No secrets appear in this note.

## Render hosting and repository state

Render's API can create a Web Service from a repository and accept per-service environment settings. Clinic-agent provisioning uses the configured private GitHub repository URL and `agent/` root directory. At the last repository-state inspection the project source was in Manus-managed Git, not a Render-accessible repository, so a private source repository that Render can clone is still required before provisioning. Do not publish the source publicly. Sources: [Render create service](https://api-docs.render.com/reference/create-service), [Render web services](https://render.com/docs/web-services), [Render deploy docs](https://render.com/docs/deploys).

A prior read-only Render API check found one workspace and zero services. No Render service creation or deployment was confirmed at that check. Recheck status when deployment resumes; do not infer current state from this note.

The application uses the per-variable environment endpoint for secret rotation and a service deploy endpoint afterward. It does not bulk-replace all variables for a one-key change and does not request secret values for display. Sources: [Update one env var](https://api-docs.render.com/reference/update-env-var), [Bulk environment variables](https://api-docs.render.com/reference/update-env-vars-for-service), [Trigger deploy](https://api-docs.render.com/reference/create-deploy).

Render Free services sleep after inactivity and can take time to wake. Use the free tier only for this non-production demo. The browser performs a bounded, visible health warm-up only after a user clicks **Start browser test**. A 25-second application message is sent only while that test call is connected. No external cron, scheduled request loop or hidden idle ping is used. A restart can interrupt an active call. Source: [Render Free limits](https://render.com/docs/free).

## Real-time audio design

The deployed agent uses `FastAPIWebsocketTransport` with protobuf serialization and the Pipecat JavaScript WebSocket client. An application-level lock limits the process to one active browser session. This supports bidirectional audio and state events for a controlled prototype, but it is not a claim of production-grade WebRTC media networking, NAT traversal, load-tested scaling or multi-client support. Sources: [Pipecat WebSocket transport](https://docs.pipecat.ai/api-reference/server/services/transport/websocket-server), [Render WebSockets](https://render.com/docs/websocket).

Pipecat's Gemini Live service provides real-time speech input/output and function calling. The default path uses Gemini native audio. Optional Cartesia TTS streams generated speech with a clinic voice ID; the agent requests text output from Gemini Live, so this path depends on selected-model text-modality support. Sources: [Pipecat Gemini Live](https://docs.pipecat.ai/api-reference/server/services/s2s/gemini-live), [Pipecat Cartesia TTS](https://docs.pipecat.ai/api-reference/server/services/tts/cartesia).

## Product and data boundaries

The dashboard and clinic agents use the same source repository but have distinct runtime roles. The dashboard has the protected Supabase secret and Render API key. Each agent has only its clinic's provider keys, tenant UUID and tenant-specific signing secret. Clinic configuration and call/appointment lifecycle metadata cross a short-lived signed bridge; the dashboard validates tenant scope before using Supabase. Agents do not persist audio, transcripts, caller identity or full conversations. Appointment records can include attendee name/email.

Clinic context supports a greeting, text knowledge field and structured FAQs. There is no uploaded-document extraction, embedding or vector search. Cal.com supports availability, booking, rescheduling and cancellation. Appointment changes require approval in the browser; existing booking changes also compare the supplied attendee email. The web human-transfer tool raises an escalation event and does not make a phone call.

The Twilio panel accepts account SID, auth token and E.164 number fields. Values can be saved to Render service configuration only; `TWILIO_ENABLED` stays false, and the application does not call Twilio, create webhooks, provision numbers or route calls.

Pipecat is open-source and does not require Pipecat Cloud. Gemini, Cartesia and Cal.com use their own provider accounts, credentials and quotas. Render Free is not an always-on production service. No healthcare-compliance certification is provided.
