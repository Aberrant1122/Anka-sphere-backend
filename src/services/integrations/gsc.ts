import { FastifyInstance } from 'fastify';
import { getGoogleAccessToken } from './google-oauth.js';
import { IntegrationRequestError } from './errors.js';

const API = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

export interface GscMetrics {
  siteUrl: string;
  rangeDays: number;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  avgPosition: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number }>;
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
}

async function query(token: string, siteUrl: string, body: object): Promise<SearchAnalyticsResponse> {
  const encoded = encodeURIComponent(siteUrl);
  let res: Response;
  try {
    res = await fetch(`${API}/${encoded}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new IntegrationRequestError('Could not reach Google Search Console.');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new IntegrationRequestError(detail?.error?.message ?? 'Search Console request failed.');
  }
  return (await res.json()) as SearchAnalyticsResponse;
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export async function fetchGscMetrics(
  app: FastifyInstance,
  siteUrl: string,
  rangeDays: number,
  projectId?: string,
): Promise<GscMetrics> {
  const token = await getGoogleAccessToken(app, projectId);
  if (token === 'mock-access-token') {
    return {
      siteUrl,
      rangeDays,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      avgPosition: 0,
      topQueries: [],
      topPages: [],
    };
  }

  // GSC data lags ~2 days; shift the window so the range is fully populated
  const range = { startDate: isoDaysAgo(rangeDays + 2), endDate: isoDaysAgo(2) };

  const [totals, queries, pages] = await Promise.all([
    query(token, siteUrl, { ...range }),
    query(token, siteUrl, { ...range, dimensions: ['query'], rowLimit: 15 }),
    query(token, siteUrl, { ...range, dimensions: ['page'], rowLimit: 10 }),
  ]);

  const t = totals.rows?.[0];
  return {
    siteUrl,
    rangeDays,
    clicks: t?.clicks ?? 0,
    impressions: t?.impressions ?? 0,
    ctr: t?.ctr ?? 0,
    avgPosition: t?.position ?? 0,
    topQueries: (queries.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    })),
    topPages: (pages.rows ?? []).map((r) => ({
      page: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
    })),
  };
}
