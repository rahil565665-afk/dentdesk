import { Router, type Request } from 'express';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { asyncRoute, HttpError, parseBody } from '../http.js';
import { requirePlatformAdmin, requireTenantRole, requireUser } from '../auth/authorization.js';
import { assertTrustedOrigin, login, logout } from '../auth/passcode.js';
import {
  createCompany,
  createCallLog,
  getCompany,
  getUsageSummary,
  listCompanies,
  listRecentCalls,
  recordAppointment,
  recordReschedule,
  updateAgentCallLog,
  updateAppointmentStatus,
  updateCompany,
  updateDeployment,
  updateIntegrationStatus,
  type ManagedCompany,
} from '../integrations/supabase.js';
import {
  assertRenderReady,
  createRenderAgentService,
  deleteRenderService,
  getLatestRenderDeploy,
  getRenderService,
  setRenderEnvironmentVariable,
  triggerRenderDeploy,
} from '../integrations/render.js';
import { assertServerConfig, voiceTokenSigningKeyHex } from '../config.js';

export const apiRouter = Router();

function tenantId(req: Request): string {
  const value = req.params.tenantId;
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '');
}

function dashboardOrigin(): string {
  const origin = (process.env.APP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('origin');
    return url.origin;
  } catch {
    throw new HttpError(503, 'Set the dashboard HTTPS origin before deploying a clinic agent.');
  }
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function configuredStatus(company: ManagedCompany, provider: string): { configured: boolean; updatedAt?: string; note?: string } {
  const entry = company.integration_status?.[provider];
  return entry ?? { configured: false };
}

async function assertAgentBridge(req: Request): Promise<string> {
  const authorization = req.header('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._-]{32,4096})$/.exec(authorization);
  if (!match) throw new HttpError(401, 'Agent authorization is required.');
  let tenantIdFromToken = '';
  try {
    const unverified = decodeJwt(match[1]!);
    tenantIdFromToken = typeof unverified.tenantId === 'string' ? unverified.tenantId : '';
  } catch {
    throw new HttpError(401, 'Agent authorization is invalid.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantIdFromToken)) {
    throw new HttpError(401, 'Agent authorization is invalid.');
  }
  try {
    const { payload } = await jwtVerify(match[1]!, new TextEncoder().encode(voiceTokenSigningKeyHex(tenantIdFromToken)), { algorithms: ['HS256'] });
    if (payload.tenantId !== tenantIdFromToken || payload.purpose !== 'agent_bridge') throw new Error('claims');
  } catch {
    throw new HttpError(401, 'Agent authorization is invalid or expired.');
  }
  return tenantIdFromToken;
}

const agentAppointmentSchema = z.object({
  bookingUid: z.string().trim().regex(/^[A-Za-z0-9_-]{6,128}$/),
  status: z.enum(['accepted', 'pending', 'cancelled', 'rescheduled', 'rejected', 'unknown']),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  appointmentType: z.string().trim().min(1).max(160),
  attendeeName: z.string().trim().min(1).max(160),
  attendeeEmail: z.string().trim().email().max(254).optional(),
  callId: z.string().uuid().nullable().optional(),
}).strict();

apiRouter.get('/agent/clinic-config', asyncRoute(async (req, res) => {
  const id = await assertAgentBridge(req);
  const company = await getCompany(id);
  if (!company.is_active) throw new HttpError(403, 'This clinic agent is inactive.');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ id: company.id, receptionist_config: { ...company.receptionist_config, clinic_name: company.name } });
}));

apiRouter.post('/agent/call-logs', asyncRoute(async (req, res) => {
  const id = await assertAgentBridge(req);
  const callId = await createCallLog(id, null, 'browser');
  res.status(201).json({ callId });
}));

apiRouter.patch('/agent/call-logs/:callId', asyncRoute(async (req, res) => {
  const id = await assertAgentBridge(req);
  const callId = typeof req.params.callId === 'string' ? req.params.callId : '';
  if (!z.string().uuid().safeParse(callId).success) throw new HttpError(400, 'Call identifier is invalid.');
  const fields = parseBody(z.object({
    ended_at: z.string().trim().max(40).refine((value) => Number.isFinite(Date.parse(value))).optional(),
    status: z.enum(['completed', 'error', 'transfer_requested']).optional(),
    transfer_requested: z.boolean().optional(),
    transfer_reason: z.string().trim().max(250).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0), req.body);
  await updateAgentCallLog(id, callId, fields);
  res.json({ ok: true });
}));

apiRouter.post('/agent/appointments', asyncRoute(async (req, res) => {
  const id = await assertAgentBridge(req);
  const input = parseBody(agentAppointmentSchema, req.body);
  await recordAppointment({
    tenantId: id,
    bookingUid: input.bookingUid,
    status: input.status,
    start: input.startsAt,
    end: input.endsAt ?? undefined,
    type: input.appointmentType,
    name: input.attendeeName,
    email: input.attendeeEmail,
    callId: input.callId ?? undefined,
  });
  res.status(201).json({ ok: true });
}));

apiRouter.patch('/agent/appointments/:bookingUid', asyncRoute(async (req, res) => {
  const id = await assertAgentBridge(req);
  const bookingUid = typeof req.params.bookingUid === 'string' ? req.params.bookingUid : '';
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(bookingUid)) throw new HttpError(400, 'Booking identifier is invalid.');
  const input = parseBody(z.object({ status: z.enum(['accepted', 'pending', 'cancelled', 'rescheduled', 'rejected', 'unknown']) }).strict(), req.body);
  await updateAppointmentStatus(id, bookingUid, input.status);
  res.json({ ok: true });
}));

apiRouter.post('/agent/appointments/reschedule', asyncRoute(async (req, res) => {
  const id = await assertAgentBridge(req);
  const input = parseBody(z.object({
    oldBookingUid: z.string().trim().regex(/^[A-Za-z0-9_-]{6,128}$/),
    newBookingUid: z.string().trim().regex(/^[A-Za-z0-9_-]{6,128}$/).nullable(),
    startsAt: z.string().datetime({ offset: true }),
    callId: z.string().uuid().nullable().optional(),
  }).strict(), req.body);
  await recordReschedule(id, input.oldBookingUid, input.newBookingUid ?? undefined, input.startsAt, input.callId ?? undefined);
  res.json({ ok: true });
}));

apiRouter.get('/health', (_req, res) => {
  try {
    assertServerConfig();
    res.json({ ok: true, service: 'dentdesk-dashboard', configurationReady: true });
  } catch {
    res.status(503).json({ ok: false, service: 'dentdesk-dashboard', configurationReady: false });
  }
});

apiRouter.get('/session', asyncRoute(async (req, res) => {
  if (!req.user) return res.json({ authenticated: false, user: null });
  const user = await requireUser(req);
  res.json({ authenticated: true, user: { id: user.id, email: user.email, name: user.display_name, isPlatformAdmin: user.is_platform_admin } });
}));

apiRouter.post('/auth/login', asyncRoute(async (req, res) => { await login(req, res); }));
apiRouter.post('/auth/logout', asyncRoute(async (req, res) => { logout(req, res); }));

apiRouter.get('/tenants', asyncRoute(async (req, res) => {
  const user = await requirePlatformAdmin(req);
  res.json({ tenants: await listCompanies(user) });
}));

const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  timezone: z.string().trim().min(1).max(64),
  receptionist_config: z.object({
    greeting: z.string().trim().min(1).max(800),
    knowledge_base: z.string().trim().min(1).max(16000),
    voice_output_mode: z.enum(['native', 'cartesia']).optional(),
  }).strict(),
  integrations: z.object({
    geminiApiKey: z.string().trim().max(4096),
    cartesiaApiKey: z.string().trim().max(4096),
    cartesiaVoiceId: z.string().trim().max(256),
    calcomApiKey: z.string().trim().max(4096),
    calcomEventTypeId: z.number().int().positive().nullable(),
    calcomEventTypeSlug: z.string().trim().max(160),
    calcomUsername: z.string().trim().max(160),
    calcomTeamSlug: z.string().trim().max(160),
  }).strict(),
}).strict();

apiRouter.post('/tenants', asyncRoute(async (req, res) => {
  await requirePlatformAdmin(req);
  const input = parseBody(createTenantSchema, req.body);
  const integration = input.integrations;
  const geminiApiKey = integration.geminiApiKey || process.env.GEMINI_API_KEY?.trim() || '';
  const cartesiaApiKey = integration.cartesiaApiKey || process.env.CARTESIA_API_KEY?.trim() || '';
  const cartesiaVoiceId = integration.cartesiaVoiceId || process.env.CARTESIA_VOICE_ID?.trim() || '';
  const calcomApiKey = integration.calcomApiKey || process.env.CALCOM_API_KEY?.trim() || '';
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim() || '';
  if (!geminiApiKey || !supabaseUrl || !supabaseSecretKey) {
    throw new HttpError(400, 'A Gemini API key and central Supabase server configuration are required. Enter Gemini in the form or configure a protected server default.');
  }
  const hasEventId = integration.calcomEventTypeId !== null;
  const hasEventSlug = Boolean(integration.calcomEventTypeSlug);
  if ((hasEventId && hasEventSlug) || (hasEventSlug && Boolean(integration.calcomUsername) === Boolean(integration.calcomTeamSlug))) {
    throw new HttpError(400, 'Use a numeric Cal.com event type ID, or a slug with exactly one username or team slug.');
  }
  await assertRenderReady();
  const origin = dashboardOrigin();
  const receptionistConfig: Record<string, unknown> = {
    clinic_name: input.name,
    greeting: input.receptionist_config.greeting,
    knowledge_base: input.receptionist_config.knowledge_base,
    voice_output_mode: input.receptionist_config.voice_output_mode ?? 'native',
    faqs: [],
    transfer_enabled: true,
    cartesia: { voice_id: cartesiaVoiceId },
    calcom: {
      event_type_id: integration.calcomEventTypeId,
      event_type_slug: integration.calcomEventTypeSlug || null,
      username: integration.calcomUsername || null,
      team_slug: integration.calcomTeamSlug || null,
    },
  };
  const company = await createCompany({
    slug: input.slug,
    name: input.name,
    businessType: 'dental_clinic',
    timezone: input.timezone,
    receptionistConfig,
  });
  await updateDeployment(company.id, { render_deployment_status: 'creating' });
  const updatedAt = new Date().toISOString();
  const integrationStatus = {
    gemini: { configured: true, updatedAt, note: 'Render environment variable present' },
    cartesia: { configured: Boolean(cartesiaApiKey && cartesiaVoiceId), updatedAt, note: cartesiaApiKey && cartesiaVoiceId ? 'Render environment variable and voice ID present' : 'Optional; enter an API key and voice ID to enable Cartesia output' },
    calcom: { configured: Boolean(calcomApiKey) && (hasEventId || (hasEventSlug && Boolean(integration.calcomUsername || integration.calcomTeamSlug))), updatedAt, note: calcomApiKey && (hasEventId || hasEventSlug) ? 'Render environment variable and event selector present' : 'Optional; configure an API key and event selector to enable scheduling' },
    supabase: { configured: true, updatedAt, note: 'Central Supabase configuration present' },
    twilio: { configured: false, note: 'Not connected' },
  };
  try {
    const created = await createRenderAgentService({
      tenantSlug: input.slug,
      tenantId: company.id,
      envVars: {
        TENANT_ID: company.id,
        GEMINI_API_KEY: geminiApiKey,
        CARTESIA_API_KEY: cartesiaApiKey,
        CALCOM_API_KEY: calcomApiKey,
        VOICE_TOKEN_SIGNING_SECRET: voiceTokenSigningKeyHex(company.id),
        DASHBOARD_ORIGIN: origin,
        TWILIO_ENABLED: 'false',
      },
    });
    const tenant = await updateCompany(company.id, {
      render_service_id: created.service.id,
      render_service_url: created.service.url,
      render_deployment_status: created.deployId ? 'building' : 'creating',
      render_last_deploy_id: created.deployId,
      render_last_deploy_at: created.deployId ? updatedAt : null,
      integration_status: integrationStatus,
    });
    res.status(201).json({ tenant });
  } catch (error) {
    await updateDeployment(company.id, { render_deployment_status: 'failed' }).catch(() => {});
    throw error;
  }
}));

apiRouter.get('/tenants/:tenantId', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id);
  res.json({ tenant: await getCompany(id) });
}));

const receptionistConfigSchema = z.object({
  clinic_name: z.string().trim().max(120).optional(),
  greeting: z.string().trim().min(1).max(800).optional(),
  knowledge_base: z.string().trim().max(16000).optional(),
  voice_output_mode: z.enum(['native', 'cartesia']).optional(),
  faqs: z.array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(2000) })).max(50).optional(),
  transfer_enabled: z.boolean().optional(),
  cartesia: z.object({ voice_id: z.string().trim().max(256).nullable().optional() }).optional(),
  calcom: z.object({
    event_type_id: z.number().int().positive().nullable().optional(),
    event_type_slug: z.string().trim().max(160).nullable().optional(),
    username: z.string().trim().max(160).nullable().optional(),
    team_slug: z.string().trim().max(160).nullable().optional(),
  }).optional(),
}).passthrough();

apiRouter.patch('/tenants/:tenantId', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id, ['owner', 'manager']);
  const schema = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    business_type: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    is_active: z.boolean().optional(),
    receptionist_config: receptionistConfigSchema.optional(),
  }).strict();
  res.json({ tenant: await updateCompany(id, parseBody(schema, req.body)) });
}));

apiRouter.get('/tenants/:tenantId/integrations', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id);
  const company = await getCompany(id);
  const centralSupabase = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim());
  const integrations = {
    gemini: configuredStatus(company, 'gemini'),
    cartesia: configuredStatus(company, 'cartesia'),
    calcom: configuredStatus(company, 'calcom'),
    twilio: configuredStatus(company, 'twilio'),
    supabase: { configured: centralSupabase, note: 'Managed centrally by the server' },
  };
  res.json({ integrations });
}));

const integrationUpdateSchema = z.object({
  provider: z.enum(['gemini', 'cartesia', 'calcom', 'twilio']),
  apiKey: z.string().trim().max(4096).optional(),
  voiceId: z.string().trim().max(256).optional(),
  eventTypeId: z.number().int().positive().nullable().optional(),
  eventTypeSlug: z.string().trim().max(160).optional(),
  username: z.string().trim().max(160).optional(),
  teamSlug: z.string().trim().max(160).optional(),
  accountSid: z.string().trim().max(128).optional(),
  authToken: z.string().trim().max(512).optional(),
  phoneNumber: z.string().trim().max(32).optional(),
}).strict();

apiRouter.put('/tenants/:tenantId/integrations', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id, ['owner', 'manager']);
  const input = parseBody(integrationUpdateSchema, req.body);
  const company = await getCompany(id);
  if (!company.render_service_id) throw new HttpError(409, 'Deploy this clinic agent before updating its service integrations.');
  const existingStatus = configuredStatus(company, input.provider);
  const updatedAt = new Date().toISOString();
  let secretChanged = false;
  let nextStatus: { configured: boolean; updatedAt?: string; note?: string } = { ...existingStatus };
  const config = { ...company.receptionist_config } as Record<string, unknown>;

  if (input.provider === 'gemini') {
    if (!input.apiKey) throw new HttpError(400, 'Enter a Gemini API key.');
    await setRenderEnvironmentVariable(company.render_service_id, 'GEMINI_API_KEY', input.apiKey);
    secretChanged = true;
    nextStatus = { configured: true, updatedAt, note: 'Configured in the Render service environment' };
  } else if (input.provider === 'cartesia') {
    if (input.apiKey) {
      await setRenderEnvironmentVariable(company.render_service_id, 'CARTESIA_API_KEY', input.apiKey);
      secretChanged = true;
    }
    if (input.voiceId) {
      const cartesia = nestedRecord(config.cartesia);
      config.cartesia = { ...cartesia, voice_id: input.voiceId };
    }
    if (!input.apiKey && !input.voiceId) throw new HttpError(400, 'Enter a Cartesia API key or voice ID.');
    nextStatus = { configured: Boolean(existingStatus.configured || input.apiKey) && Boolean((nestedRecord(config.cartesia)).voice_id), updatedAt, note: 'Credentials stay server-side; voice ID is clinic configuration' };
  } else if (input.provider === 'calcom') {
    if (input.apiKey) {
      await setRenderEnvironmentVariable(company.render_service_id, 'CALCOM_API_KEY', input.apiKey);
      secretChanged = true;
    }
    const calcom = nestedRecord(config.calcom);
    const hasNewId = typeof input.eventTypeId === 'number' && Number.isInteger(input.eventTypeId) && input.eventTypeId > 0;
    const hasNewSlug = Boolean(input.eventTypeSlug);
    if (hasNewId && hasNewSlug) throw new HttpError(400, 'Use either a numeric Cal.com event type ID or a slug, not both.');
    if (hasNewId) {
      config.calcom = { ...calcom, event_type_id: input.eventTypeId, event_type_slug: null, username: null, team_slug: null };
    } else if (hasNewSlug) {
      const username = input.username || null;
      const teamSlug = input.teamSlug || null;
      if (Boolean(username) === Boolean(teamSlug)) throw new HttpError(400, 'A Cal.com event slug needs exactly one username or team slug.');
      config.calcom = { ...calcom, event_type_id: null, event_type_slug: input.eventTypeSlug, username, team_slug: teamSlug };
    } else if (input.username || input.teamSlug) {
      if (Boolean(input.username) === Boolean(input.teamSlug)) throw new HttpError(400, 'Use either a username or team slug.');
      config.calcom = { ...calcom, username: input.username || null, team_slug: input.teamSlug || null };
    }
    if (!input.apiKey && !hasNewId && !hasNewSlug && !input.username && !input.teamSlug) throw new HttpError(400, 'Enter a Cal.com API key or event selector.');
    const resolved = nestedRecord(config.calcom);
    nextStatus = {
      configured: Boolean(existingStatus.configured || input.apiKey) && Boolean(resolved.event_type_id || (resolved.event_type_slug && (resolved.username || resolved.team_slug))),
      updatedAt,
      note: 'Credentials stored server-side; event selector is clinic configuration',
    };
  } else {
    const accountSid = input.accountSid?.trim() ?? '';
    const authToken = input.authToken?.trim() ?? '';
    const phoneNumber = input.phoneNumber?.trim() ?? '';
    if (!/^AC[a-zA-Z0-9]{20,64}$/.test(accountSid) || authToken.length < 16 || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      throw new HttpError(400, 'Enter a Twilio Account SID, Auth Token and E.164 phone number. Values are stored only; Twilio remains disconnected.');
    }
    await Promise.all([
      setRenderEnvironmentVariable(company.render_service_id, 'TWILIO_ACCOUNT_SID', accountSid),
      setRenderEnvironmentVariable(company.render_service_id, 'TWILIO_AUTH_TOKEN', authToken),
      setRenderEnvironmentVariable(company.render_service_id, 'TWILIO_PHONE_NUMBER', phoneNumber),
      setRenderEnvironmentVariable(company.render_service_id, 'TWILIO_ENABLED', 'false'),
    ]);
    secretChanged = true;
    nextStatus = { configured: true, updatedAt, note: 'Credentials stored only; phone transport remains disabled and no Twilio API calls are made' };
  }

  if (input.provider === 'cartesia' || input.provider === 'calcom') await updateCompany(id, { receptionist_config: config });
  if (secretChanged) {
    const deployment = await triggerRenderDeploy(company.render_service_id);
    await updateDeployment(id, {
      render_deployment_status: 'building',
      render_last_deploy_id: deployment.deployId,
      render_last_deploy_at: updatedAt,
    });
  }
  await updateIntegrationStatus(id, input.provider, nextStatus);
  res.json({ ok: true, provider: input.provider, message: input.provider === 'twilio'
    ? 'Credentials saved to the Render service. Twilio remains disabled; no Twilio API or phone configuration was used.'
    : 'Configuration saved server-side. Secret values are not returned.' });
}));

apiRouter.get('/tenants/:tenantId/deployment-status', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id);
  const company = await getCompany(id);
  if (!company.render_service_id) {
    return res.json({ serviceConfigured: false, published: false, runtimeReady: null, status: company.render_deployment_status ?? 'Not deployed', message: 'No Render service is registered.' });
  }
  const [service, deploy] = await Promise.all([
    getRenderService(company.render_service_id),
    getLatestRenderDeploy(company.render_service_id),
  ]);
  const status = deploy?.status ?? company.render_deployment_status ?? 'unknown';
  await updateDeployment(id, {
    render_service_url: service.url,
    render_deployment_status: status === 'live' ? 'live' : status === 'build_failed' || status === 'update_failed' ? 'failed' : service.suspended === 'suspended' ? 'suspended' : 'building',
    render_last_deploy_id: deploy?.id ?? company.render_last_deploy_id ?? null,
    render_last_deploy_at: deploy?.updatedAt ?? deploy?.createdAt ?? company.render_last_deploy_at ?? null,
  });
  const updatedCompany = await getCompany(id);
  res.json({
    serviceConfigured: true,
    published: Boolean(service.url),
    runtimeReady: null,
    status: service.suspended === 'suspended' ? 'Suspended / waking on request' : status,
    serviceUrl: service.url,
    deployId: deploy?.id ?? null,
    tenant: updatedCompany,
    message: 'Runtime health is probed only after the user starts a voice test so dashboard refresh does not wake a sleeping Free service.',
  });
}));

apiRouter.post('/tenants/:tenantId/redeploy', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requirePlatformAdmin(req);
  const company = await getCompany(id);
  if (!company.render_service_id) throw new HttpError(409, 'This clinic has no Render agent to redeploy.');
  const result = await triggerRenderDeploy(company.render_service_id);
  await updateDeployment(id, {
    render_deployment_status: 'building',
    render_last_deploy_id: result.deployId,
    render_last_deploy_at: new Date().toISOString(),
  });
  res.json({ ok: true, deployId: result.deployId, message: 'Render redeployment was requested.' });
}));

apiRouter.delete('/tenants/:tenantId/agent', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requirePlatformAdmin(req);
  const company = await getCompany(id);
  if (!company.render_service_id) throw new HttpError(409, 'This clinic has no Render agent service to remove.');
  await deleteRenderService(company.render_service_id);
  await updateDeployment(id, {
    render_service_id: null,
    render_service_url: null,
    render_deployment_status: 'not_created',
    render_last_deploy_id: null,
    render_last_deploy_at: null,
  });
  const updatedAt = new Date().toISOString();
  for (const provider of ['gemini', 'cartesia', 'calcom', 'twilio'] as const) {
    await updateIntegrationStatus(id, provider, {
      configured: false,
      updatedAt,
      note: 'Render agent removed; configure again when creating another service',
    });
  }
  const updatedCompany = await getCompany(id);
  res.json({ ok: true, tenant: updatedCompany, message: 'Render service deleted; clinic call and appointment history was preserved.' });
}));

apiRouter.post('/tenants/:tenantId/voice-token', asyncRoute(async (req, res) => {
  assertTrustedOrigin(req);
  const id = tenantId(req);
  await requireTenantRole(req, id);
  const company = await getCompany(id);
  if (!company.is_active) throw new HttpError(409, 'This clinic is inactive.');
  if (!company.render_service_url) throw new HttpError(409, 'This clinic has no deployed voice agent.');
  const receptionist = company.receptionist_config ?? {};
  const voiceOutputMode = receptionist.voice_output_mode === 'cartesia' ? 'cartesia' : 'native';
  if (voiceOutputMode === 'cartesia' && !configuredStatus(company, 'cartesia').configured) {
    throw new HttpError(409, 'Configure the Cartesia API key and voice ID before using Cartesia output.');
  }
  const token = await new SignJWT({ tenantId: id, purpose: 'voice', voiceOutputMode })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('3m')
    .sign(new TextEncoder().encode(voiceTokenSigningKeyHex(id)));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token, expiresInSeconds: 180 });
}));

apiRouter.get('/tenants/:tenantId/usage', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id);
  res.json(await getUsageSummary(id));
}));

apiRouter.get('/tenants/:tenantId/calls', asyncRoute(async (req, res) => {
  const id = tenantId(req);
  await requireTenantRole(req, id);
  res.json({ calls: await listRecentCalls(id) });
}));
