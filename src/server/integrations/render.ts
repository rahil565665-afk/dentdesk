import { HttpError } from '../http.js';

const RENDER_API = 'https://api.render.com/v1';
const REQUEST_TIMEOUT_MS = 20_000;

export interface RenderServiceSummary {
  id: string;
  name: string;
  slug: string;
  url: string | null;
  suspended: string | null;
  updatedAt: string | null;
  dashboardUrl: string | null;
}

export interface RenderDeploySummary {
  id: string;
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
}

interface RenderServiceRecord {
  id?: string;
  name?: string;
  slug?: string;
  ownerId?: string;
  suspended?: string;
  updatedAt?: string;
  dashboardUrl?: string;
  serviceDetails?: { url?: string; [key: string]: unknown };
}

function renderKey(): string {
  const value = process.env.RENDER_API_KEY?.trim();
  if (!value) throw new HttpError(503, 'Render provisioning is not configured.');
  return value;
}

function repoDetails(): { repo: string; branch: string; region: string } {
  const repo = process.env.RENDER_REPO_URL?.trim();
  if (!repo) throw new HttpError(503, 'Connect a private Git repository before deploying clinic agents.');
  let url: URL;
  try { url = new URL(repo); } catch { throw new HttpError(503, 'The configured Render repository URL is invalid.'); }
  const repoPath = url.pathname.replace(/\.git$/, '');
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoPath)) {
    throw new HttpError(503, 'Set RENDER_REPO_URL to a private GitHub repository URL without embedded credentials.');
  }
  const branch = process.env.RENDER_BRANCH?.trim() || 'main';
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..')) throw new HttpError(503, 'The configured Render branch name is invalid.');
  const region = process.env.RENDER_REGION?.trim() || 'singapore';
  if (!['frankfurt', 'oregon', 'ohio', 'singapore', 'virginia'].includes(region)) throw new HttpError(503, 'The configured Render region is invalid.');
  return { repo: `${url.origin}${repoPath}`, branch, region };
}

async function renderRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${RENDER_API}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${renderKey()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const status = response.status === 429 ? 503 : 502;
    throw new HttpError(status, `Render rejected the request (HTTP ${response.status}). Check the service configuration and Render account access.`);
  }
  return await response.json() as T;
}

async function workspaceId(): Promise<string> {
  const configured = process.env.RENDER_OWNER_ID?.trim();
  if (configured) return configured;
  const owners = await renderRequest<Array<{ owner?: { id?: string; name?: string; type?: string }; cursor?: string }>>('/owners?limit=20');
  const ids = (Array.isArray(owners) ? owners : []).map((entry) => entry.owner?.id).filter((id): id is string => Boolean(id));
  if (ids.length !== 1) throw new HttpError(503, 'Set RENDER_OWNER_ID because this Render API key can access more than one workspace or none.');
  return ids[0]!;
}

function summary(record: RenderServiceRecord): RenderServiceSummary {
  const url = record.serviceDetails?.url;
  return {
    id: record.id ?? '',
    name: record.name ?? 'Clinic agent',
    slug: record.slug ?? '',
    url: typeof url === 'string' && /^https:\/\//.test(url) ? url.replace(/\/$/, '') : null,
    suspended: record.suspended ?? null,
    updatedAt: record.updatedAt ?? null,
    dashboardUrl: record.dashboardUrl && /^https:\/\//.test(record.dashboardUrl) ? record.dashboardUrl : null,
  };
}

export async function assertRenderReady(): Promise<void> {
  renderKey();
  repoDetails();
  await workspaceId();
}

export async function createRenderAgentService(input: {
  tenantSlug: string;
  tenantId: string;
  envVars: Record<string, string | undefined>;
}): Promise<{ service: RenderServiceSummary; deployId: string | null }> {
  const { repo, branch, region } = repoDetails();
  const ownerId = await workspaceId();
  const slug = input.tenantSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'clinic';
  const safeTenantSuffix = input.tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
  const envVars = Object.entries(input.envVars)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([key, value]) => ({ key, value }));
  const payload = {
    type: 'web_service',
    name: `dentdesk-agent-${slug}-${safeTenantSuffix}`.slice(0, 63),
    ownerId,
    repo,
    branch,
    rootDir: 'agent',
    autoDeployTrigger: 'commit',
    envVars,
    serviceDetails: {
      runtime: 'python',
      region,
      plan: 'free',
      numInstances: 1,
      envSpecificDetails: {
        buildCommand: 'pip install -r requirements.txt',
        startCommand: 'uvicorn main:APP --host 0.0.0.0 --port $PORT --no-access-log',
      },
      healthCheckPath: '/health',
    },
  };
  const result = await renderRequest<{ service?: RenderServiceRecord; deployId?: string }>('/services', {
    method: 'POST', body: JSON.stringify(payload),
  });
  if (!result.service?.id) throw new HttpError(502, 'Render accepted a service request but returned no service ID. Check Render before retrying to avoid creating a duplicate.');
  return { service: summary(result.service), deployId: result.deployId ?? null };
}

export async function getRenderService(serviceId: string): Promise<RenderServiceSummary> {
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId)) throw new HttpError(400, 'The stored Render service ID is invalid.');
  const result = await renderRequest<RenderServiceRecord>(`/services/${encodeURIComponent(serviceId)}`);
  return summary(result);
}

export async function getLatestRenderDeploy(serviceId: string): Promise<RenderDeploySummary | null> {
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId)) throw new HttpError(400, 'The stored Render service ID is invalid.');
  const rows = await renderRequest<Array<{ deploy?: { id?: string; status?: string; createdAt?: string; startedAt?: string; finishedAt?: string; updatedAt?: string } }>>(`/services/${encodeURIComponent(serviceId)}/deploys?limit=1`);
  const deploy = Array.isArray(rows) ? rows[0]?.deploy : undefined;
  if (!deploy?.id) return null;
  return {
    id: deploy.id,
    status: deploy.status ?? 'unknown',
    createdAt: deploy.createdAt ?? null,
    startedAt: deploy.startedAt ?? null,
    finishedAt: deploy.finishedAt ?? null,
    updatedAt: deploy.updatedAt ?? null,
  };
}

export async function setRenderEnvironmentVariable(serviceId: string, key: string, value: string): Promise<void> {
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId) || !/^[A-Z][A-Z0-9_]{0,99}$/.test(key)) throw new HttpError(400, 'The Render service or environment variable identifier is invalid.');
  await renderRequest<unknown>(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT', body: JSON.stringify({ value }),
  });
}

export async function removeRenderEnvironmentVariable(serviceId: string, key: string): Promise<void> {
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId) || !/^[A-Z][A-Z0-9_]{0,99}$/.test(key)) throw new HttpError(400, 'The Render service or environment variable identifier is invalid.');
  await renderRequest<unknown>(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export async function triggerRenderDeploy(serviceId: string): Promise<{ deployId: string | null }> {
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId)) throw new HttpError(400, 'The stored Render service ID is invalid.');
  const result = await renderRequest<{ id?: string }>(`/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST', body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  return { deployId: result.id ?? null };
}

export async function deleteRenderService(serviceId: string): Promise<void> {
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId)) throw new HttpError(400, 'The stored Render service ID is invalid.');
  await renderRequest<unknown>(`/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' });
}
