import { useEffect, useRef, useState } from 'react';
import { PipecatClient } from '@pipecat-ai/client-js';
import { ProtobufFrameSerializer, WebSocketTransport } from '@pipecat-ai/websocket-transport';
import { AudioLines, Check, CircleStop, Headphones, Mic, MicOff, Phone, ShieldAlert, X } from 'lucide-react';
import type { Company, VoiceStatus } from './types.js';

interface Transcript { role: 'assistant' | 'user' | 'system'; text: string; }
interface Pending { approvalId: string; summary: string; }
interface VoiceTokenResponse { token: string; expiresInSeconds: number; }

const WAKE_TIMEOUT_MS = 90_000;
const HEALTH_REQUEST_TIMEOUT_MS = 4_000;
const HEALTH_POLL_INTERVAL_MS = 3_000;

function makeWebSocketUrl(agentUrl: string): string {
  const url = new URL(agentUrl);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('The configured voice agent URL must use HTTP or HTTPS.');
  if (!url.pathname.replace(/\/+$/, '').endsWith('/ws')) url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`;
  return url.toString();
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, milliseconds);
    const cancel = () => { window.clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export function VoiceTester({ tenant }: { tenant: Company }) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const clientRef = useRef<PipecatClient | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const userDraftRef = useRef(false);
  const outputSegmentRef = useRef<number | string | null>(null);

  useEffect(() => { transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' }); }, [transcript]);
  useEffect(() => {
    if (status === 'idle' || status === 'disconnected' || status === 'error') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(() => () => {
    runAbortRef.current?.abort();
    if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.disconnect().catch(() => {});
  }, []);

  function appendTranscript(item: Transcript) { setTranscript((rows) => [...rows, item]); }

  async function waitForAgent(agentUrl: string, signal: AbortSignal): Promise<boolean> {
    const healthUrl = new URL('/health', agentUrl).toString();
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (Date.now() < deadline && !signal.aborted) {
      const remaining = deadline - Date.now();
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      signal.addEventListener('abort', abortRequest, { once: true });
      const timeout = window.setTimeout(() => requestController.abort(), Math.min(HEALTH_REQUEST_TIMEOUT_MS, remaining));
      try {
        const response = await fetch(healthUrl, { method: 'GET', signal: requestController.signal });
        if (response.ok) return true;
      } catch {
        if (signal.aborted) return false;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abortRequest);
      }
      const untilNextPoll = deadline - Date.now();
      if (untilNextPoll > 0) {
        try { await abortableDelay(Math.min(HEALTH_POLL_INTERVAL_MS, untilNextPoll), signal); }
        catch { return false; }
      }
    }
    return false;
  }

  async function start() {
    if (startingRef.current || clientRef.current) return;
    setError(''); setTranscript([]); setElapsed(0); setPending(null); setStatus('connecting');
    userDraftRef.current = false; outputSegmentRef.current = null;
    if (!tenant.agentUrl?.trim()) {
      setError('Voice agent is not deployed for this clinic. Configure an agent URL before starting a test call.');
      setStatus('error');
      return;
    }
    startingRef.current = true;
    const runController = new AbortController();
    runAbortRef.current = runController;
    try {
      const agentUrl = tenant.agentUrl.trim();
      const websocketUrl = makeWebSocketUrl(agentUrl);
      setStatus('waking');
      const isReady = await waitForAgent(agentUrl, runController.signal);
      if (runController.signal.aborted) return;
      if (!isReady) {
        setError('The voice agent did not wake within 90 seconds. Please try again in a moment.');
        setStatus('error');
        return;
      }

      const tokenResponse = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}/voice-token`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: runController.signal,
      });
      if (!tokenResponse.ok) throw new Error('Could not authorize a voice test. Reload the page and try again.');
      const tokenData = await tokenResponse.json() as VoiceTokenResponse;
      if (typeof tokenData.token !== 'string' || !tokenData.token) throw new Error('The voice authorization response was invalid.');
      if (runController.signal.aborted) return;

      let client: PipecatClient | null = null;
      client = new PipecatClient({
        transport: new WebSocketTransport({
          serializer: new ProtobufFrameSerializer(),
          recorderSampleRate: 16000,
          playerSampleRate: 24000,
        }),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onTransportStateChanged: (transportState) => {
            if (transportState === 'connecting' || transportState === 'connected' || transportState === 'authenticating') setStatus('connecting');
            else if (transportState === 'ready') setStatus('listening');
          },
          onConnected: () => setStatus('connecting'),
          onDisconnected: () => {
            if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
            if (clientRef.current === client) clientRef.current = null;
            setStatus((current) => current === 'error' ? 'error' : 'disconnected');
          },
          onBotReady: () => { setError(''); setStatus('listening'); },
          onError: () => {
            if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
            setError('The voice session encountered a connection error. Please try again.');
            setStatus('error');
            if (clientRef.current === client) clientRef.current = null;
            void client?.disconnect().catch(() => {});
          },
          onUserInput: (data) => {
            if (!data.text?.trim()) return;
            const replaceDraft = userDraftRef.current;
            userDraftRef.current = !data.final;
            setTranscript((rows) => {
              const last = rows[rows.length - 1];
              if (replaceDraft && last?.role === 'user') return [...rows.slice(0, -1), { role: 'user', text: data.text }];
              return [...rows, { role: 'user', text: data.text }];
            });
          },
          onBotOutput: (data) => {
            if (!data.text?.trim()) return;
            const segmentId = data.segment_id ?? null;
            const sameSegment = segmentId === null || segmentId === outputSegmentRef.current;
            outputSegmentRef.current = segmentId;
            setTranscript((rows) => {
              const last = rows[rows.length - 1];
              if (sameSegment && last?.role === 'assistant') {
                return [...rows.slice(0, -1), { role: 'assistant', text: data.text }];
              }
              return [...rows, { role: 'assistant', text: data.text }];
            });
          },
          onUserStartedSpeaking: () => setStatus('processing'),
          onBotStartedSpeaking: () => setStatus('speaking'),
          onBotStoppedSpeaking: () => setStatus('listening'),
          onServerMessage: (data: unknown) => {
            if (!data || typeof data !== 'object') return;
            const message = data as { type?: unknown; approvalId?: unknown; operation?: unknown; summary?: unknown; reason?: unknown };
            if (message.type === 'dental.approval.request' && typeof message.approvalId === 'string' && typeof message.operation === 'string' && message.summary && typeof message.summary === 'object') {
              const details = message.summary as Record<string, unknown>;
              const readable = Object.entries(details).map(([key, value]) => `${key.replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ')}: ${String(value)}`).join('\n');
              setPending({ approvalId: message.approvalId, summary: `${message.operation.replaceAll('_', ' ')}\n${readable}` });
            }
            if (message.type === 'dental.escalation.requested') {
              setStatus('transfer_requested');
              setError(typeof message.reason === 'string' ? `A clinic team member has been requested: ${message.reason}. This browser test cannot transfer the call to a phone line.` : 'A clinic team member has been requested. This browser test cannot transfer the call to a phone line.');
            }
          },
        },
      });
      clientRef.current = client;
      setStatus('connecting');
      await client.connect({ wsUrl: websocketUrl, token: tokenData.token });
      if (runController.signal.aborted) {
        if (clientRef.current === client) clientRef.current = null;
        await client.disconnect().catch(() => {});
      } else if (clientRef.current === client) {
        heartbeatRef.current = window.setInterval(() => {
          if (clientRef.current === client) client.sendClientMessage('dental.active.heartbeat', { at: Date.now() });
        }, 25_000);
      }
    } catch (cause) {
      if (!runController.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not start the voice test. Please try again.');
        setStatus('error');
        const client = clientRef.current;
        clientRef.current = null;
        if (client) await client.disconnect().catch(() => {});
      }
    } finally {
      if (runAbortRef.current === runController) runAbortRef.current = null;
      startingRef.current = false;
    }
  }

  function stop() {
    runAbortRef.current?.abort();
    runAbortRef.current = null;
    if (heartbeatRef.current !== null) window.clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.disconnect().catch(() => {});
    setStatus('disconnected');
    setPending(null);
  }

  function decide(approved: boolean) {
    if (pending) clientRef.current?.sendClientMessage('dental.approval.response', { approvalId: pending.approvalId, approved });
    if (!approved) appendTranscript({ role: 'system', text: 'Appointment action was not approved. No change was made.' });
    setPending(null);
  }

  const live = !['idle', 'disconnected', 'error'].includes(status);
  const statusLabel: Record<VoiceStatus, string> = {
    idle: 'Ready to test', waking: 'Waking agent…', connecting: 'Connecting to assistant', listening: 'Listening', processing: 'Processing request', speaking: 'Assistant speaking', transfer_requested: 'Handoff requested', disconnected: 'Call ended', error: 'Connection needs attention',
  };
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  const visibleError = error || (!tenant.agentUrl?.trim() ? 'Voice agent is not deployed for this clinic.' : '');

  return <div className="voice-layout">
    <section className="voice-stage panel">
      <div className="voice-stage-top"><div><div className="eyebrow">LIVE BROWSER SESSION</div><h2>{tenant.name}</h2></div><span className={`call-state ${live ? 'live' : 'done'}`}><i />{statusLabel[status]}</span></div>
      <div className={`voice-circle ${status}`}><div className="voice-circle-inner"><div className="voice-ring ring-one" /><div className="voice-ring ring-two" />{status === 'error' ? <ShieldAlert size={27} /> : status === 'disconnected' ? <MicOff size={25} /> : <AudioLines size={28} />}</div></div>
      <div className="voice-timer">{minutes}:{seconds}</div>
      <p className="voice-caption">{status === 'idle' ? 'Your microphone is off until you begin a test call.' : status === 'waking' ? 'Waking the voice agent after your request. This can take up to 90 seconds.' : status === 'listening' ? 'Say hello. The assistant will answer using this clinic’s configuration.' : status === 'speaking' ? 'Listen to the response, or speak to interrupt.' : status === 'transfer_requested' ? 'A handoff event has been recorded for clinic staff. No phone transfer occurred.' : status === 'disconnected' ? 'The test session has ended.' : statusLabel[status] + '…'}</p>
      {visibleError && <div className="alert error voice-error">{visibleError}</div>}
      <div className="voice-controls">{live ? <button className="button danger" onClick={stop}><CircleStop size={17} /> End test call</button> : <button className="button primary" onClick={() => void start()}><Phone size={16} /> Start browser test</button>}</div>
      <div className="audio-privacy"><ShieldAlert size={14} /> Audio streams live and is not recorded.</div>
    </section>
    <section className="transcript-panel panel">
      <div className="panel-head"><div><div className="eyebrow">CONVERSATION</div><h2>Live transcript</h2></div><span className="mini-badge">TEXT ONLY</span></div>
      <div className="transcript-list" ref={transcriptRef}>{transcript.length ? transcript.map((item, index) => <div className={`transcript-line ${item.role}`} key={index}><span>{item.role === 'assistant' ? 'ASSISTANT' : item.role === 'user' ? 'CALLER' : 'SYSTEM'}</span><p>{item.text}</p></div>) : <div className="transcript-empty"><Headphones size={22} /><p>Start a test call to see the conversation here.</p></div>}</div>
      <div className="transcript-footer"><Mic size={14} /> {live ? 'Microphone connected · Browser audio' : 'No active microphone'}<span className={live ? 'status-dot mint' : 'status-dot'} /></div>
    </section>
    {pending && <div className="modal-backdrop"><section className="modal-card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="appointment-confirmation-title"><div className="confirm-icon"><ShieldAlert size={20} /></div><div className="eyebrow">CALLER APPROVAL REQUIRED</div><h2 id="appointment-confirmation-title">Confirm appointment action</h2><p>{pending.summary}</p><div className="confirm-warning">Nothing will be changed until you approve this action.</div><div className="modal-actions"><button className="button ghost" onClick={() => decide(false)}><X size={15} /> Don’t proceed</button><button className="button primary" onClick={() => decide(true)}><Check size={15} /> Approve action</button></div></section></div>}
  </div>;
}
