import type { CredentialVault } from './crypto.js';

export type ConnectionCategory =
  | 'telegram'
  | 'webhook'
  | 'slack'
  | 'discord'
  | 'github'
  | 'api_token'
  | 'custom';

export interface ConnectionPreset {
  category: ConnectionCategory;
  name: string;
  label: string;
  description: string;
  defaultEndpointUrl: string;
  endpointLabel: string;
  endpointPlaceholder: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  showWebhookSecret: boolean;
  webhookSecretLabel: string;
  defaultHeaderName: string;
  docsHint: string;
}

interface EncryptedConnectionPayload {
  token?: string;
  webhookSecret?: string;
  headerValue?: string;
  extra?: Record<string, string>;
}

export interface ConnectionRecordInternal {
  id: string;
  name: string;
  label: string;
  category: ConnectionCategory;
  description: string;
  endpointUrl: string;
  headerName: string;
  encryptedPayload: string;
  metadata: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionPublic {
  id: string;
  name: string;
  label: string;
  category: ConnectionCategory;
  description: string;
  endpointUrl: string;
  headerName: string;
  hasToken: boolean;
  maskedToken: string | null;
  hasWebhookSecret: boolean;
  maskedWebhookSecret: string | null;
  hasHeaderValue: boolean;
  maskedHeaderValue: string | null;
  extraKeys: string[];
  extraMasked: Record<string, string>;
  metadata: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedConnection {
  id: string;
  name: string;
  label: string;
  category: ConnectionCategory;
  url: string;
  webhook_url: string;
  token: string | null;
  value: string | null;
  secret: string | null;
  webhook_secret: string | null;
  header_name: string;
  header_value: string | null;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  extra: Record<string, string>;
}

export interface UpsertConnectionInput {
  id?: string;
  name: string;
  label?: string;
  category?: ConnectionCategory;
  description?: string;
  endpointUrl?: string;
  headerName?: string;
  token?: string | null;
  clearToken?: boolean;
  webhookSecret?: string | null;
  clearWebhookSecret?: boolean;
  headerValue?: string | null;
  clearHeaderValue?: boolean;
  extra?: Record<string, string>;
  keepExtraKeys?: string[];
  metadata?: Record<string, string>;
  enabled?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  category: ConnectionCategory;
  message: string;
  latencyMs: number;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export const CONNECTION_PRESETS: ConnectionPreset[] = [
  {
    category: 'telegram',
    name: 'telegram_bot_token',
    label: 'Telegram Bot',
    description: 'Store your @BotFather token, webhook secret, and allowed chat IDs for Telegram bots & alerts.',
    defaultEndpointUrl: 'https://api.telegram.org',
    endpointLabel: 'Telegram Bot API Base URL',
    endpointPlaceholder: 'https://api.telegram.org',
    tokenLabel: 'Bot Token (@BotFather)',
    tokenPlaceholder: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    showWebhookSecret: true,
    webhookSecretLabel: 'Webhook Secret Token (X-Telegram-Bot-Api-Secret-Token)',
    defaultHeaderName: '',
    docsHint: 'Used automatically by Telegram AI Chat Bot or via connections.token("telegram_bot_token").'
  },
  {
    category: 'webhook',
    name: 'custom_webhook',
    label: 'Webhook Endpoint',
    description: 'Save any inbound/outbound webhook URL plus optional signing secret or auth header.',
    defaultEndpointUrl: '',
    endpointLabel: 'Webhook URL',
    endpointPlaceholder: 'https://example.com/webhooks/poseidon',
    tokenLabel: 'Bearer / Auth Token (Optional)',
    tokenPlaceholder: 'Optional bearer token sent with webhook calls',
    showWebhookSecret: true,
    webhookSecretLabel: 'Webhook Signing Secret (HMAC / Verification)',
    defaultHeaderName: 'X-Webhook-Secret',
    docsHint: 'Use notify.webhook(connections.url("custom_webhook"), payload, conn.headers).'
  },
  {
    category: 'slack',
    name: 'slack_webhook',
    label: 'Slack Webhook / Bot',
    description: 'Save a Slack Incoming Webhook URL or Bot User OAuth Token (xoxb-...).',
    defaultEndpointUrl: '',
    endpointLabel: 'Slack Webhook URL',
    endpointPlaceholder: 'https://hooks.slack.com/services/T000/B000/XXXX',
    tokenLabel: 'Slack Bot Token (Optional xoxb-...)',
    tokenPlaceholder: 'xoxb-...',
    showWebhookSecret: true,
    webhookSecretLabel: 'Slack Signing Secret (Optional)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Use notify.slack(connections.url("slack_webhook"), "Deployment succeeded!").'
  },
  {
    category: 'discord',
    name: 'discord_webhook',
    label: 'Discord Webhook / Bot',
    description: 'Save a Discord channel webhook URL or Bot token for workflow notifications.',
    defaultEndpointUrl: '',
    endpointLabel: 'Discord Webhook URL',
    endpointPlaceholder: 'https://discord.com/api/webhooks/123456/abcdef',
    tokenLabel: 'Discord Bot Token (Optional)',
    tokenPlaceholder: 'Optional Discord bot token',
    showWebhookSecret: false,
    webhookSecretLabel: 'Secret (Optional)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Use notify.discord(connections.url("discord_webhook"), "Build complete!").'
  },
  {
    category: 'github',
    name: 'github_token',
    label: 'GitHub Token / Webhook',
    description: 'Personal access token (PAT) and optional GitHub webhook HMAC secret.',
    defaultEndpointUrl: 'https://api.github.com',
    endpointLabel: 'GitHub API Base URL',
    endpointPlaceholder: 'https://api.github.com',
    tokenLabel: 'GitHub Personal Access Token',
    tokenPlaceholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    showWebhookSecret: true,
    webhookSecretLabel: 'GitHub Webhook Secret (X-Hub-Signature-256)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Use http.get(connections.url("github_token") .. "/user", connections.get("github_token").headers).'
  },
  {
    category: 'api_token',
    name: 'api_token',
    label: 'API Key / Bearer Token',
    description: 'Store any third-party REST API token, base URL, and custom auth header.',
    defaultEndpointUrl: '',
    endpointLabel: 'API Base URL (Optional)',
    endpointPlaceholder: 'https://api.service.com/v1',
    tokenLabel: 'API Key / Bearer Token',
    tokenPlaceholder: 'sk_live_...',
    showWebhookSecret: false,
    webhookSecretLabel: 'Secondary Secret (Optional)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Read in any Lua script with connections.token("api_token") or context.secrets.api_token.value.'
  },
  {
    category: 'custom',
    name: 'my_connection',
    label: 'Custom Connection',
    description: 'Flexible encrypted connection with token, endpoint URL, webhook secret, headers, and custom key-value secrets.',
    defaultEndpointUrl: '',
    endpointLabel: 'Endpoint / Webhook URL (Optional)',
    endpointPlaceholder: 'https://...',
    tokenLabel: 'Primary Token / Secret',
    tokenPlaceholder: 'Token or secret value',
    showWebhookSecret: true,
    webhookSecretLabel: 'Webhook / Signing Secret (Optional)',
    defaultHeaderName: 'X-API-Key',
    docsHint: 'Access all fields via connections.get("my_connection") or context.secrets["my_connection"].'
  }
];

function maskSecret(val: string | undefined | null): string | null {
  if (!val) return null;
  const s = val.trim();
  if (!s) return null;
  if (s.length <= 8) return `${s.slice(0, 2)}••••`;
  return `${s.slice(0, 5)}••••${s.slice(-4)}`;
}

function slugifyId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || `conn_${Date.now()}`;
}

export class ConnectionRegistry {
  private readonly records = new Map<string, ConnectionRecordInternal>();

  constructor(private readonly vault: CredentialVault) {
    this.seedFromEnvironment();
  }

  private seedFromEnvironment(): void {
    const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const tgSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (tgToken || tgSecret) {
      this.upsertConnection({
        id: 'telegram_bot_token',
        name: 'telegram_bot_token',
        label: 'Telegram Bot (Env)',
        category: 'telegram',
        description: 'Seeded from environment variables',
        endpointUrl: process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org',
        token: tgToken || undefined,
        webhookSecret: tgSecret || undefined,
        enabled: true
      });
    }

    const slackUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    if (slackUrl) {
      this.upsertConnection({
        id: 'slack_webhook',
        name: 'slack_webhook',
        label: 'Slack Webhook (Env)',
        category: 'slack',
        description: 'Seeded from SLACK_WEBHOOK_URL',
        endpointUrl: slackUrl,
        enabled: true
      });
    }

    const discordUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
    if (discordUrl) {
      this.upsertConnection({
        id: 'discord_webhook',
        name: 'discord_webhook',
        label: 'Discord Webhook (Env)',
        category: 'discord',
        description: 'Seeded from DISCORD_WEBHOOK_URL',
        endpointUrl: discordUrl,
        enabled: true
      });
    }
  }

  getPresets(): ConnectionPreset[] {
    return CONNECTION_PRESETS.map(p => ({ ...p }));
  }

  private decryptPayload(record: ConnectionRecordInternal): EncryptedConnectionPayload {
    try {
      const dec = this.vault.decrypt(record.encryptedPayload) as EncryptedConnectionPayload;
      return {
        token: typeof dec.token === 'string' ? dec.token : undefined,
        webhookSecret: typeof dec.webhookSecret === 'string' ? dec.webhookSecret : undefined,
        headerValue: typeof dec.headerValue === 'string' ? dec.headerValue : undefined,
        extra: dec.extra && typeof dec.extra === 'object' ? { ...dec.extra } : {}
      };
    } catch {
      return { extra: {} };
    }
  }

  private toPublic(record: ConnectionRecordInternal): ConnectionPublic {
    const secrets = this.decryptPayload(record);
    const extraObj = secrets.extra ?? {};
    const extraKeys = Object.keys(extraObj);
    const extraMasked: Record<string, string> = {};
    for (const k of extraKeys) {
      extraMasked[k] = maskSecret(extraObj[k]) ?? '••••';
    }
    return {
      id: record.id,
      name: record.name,
      label: record.label,
      category: record.category,
      description: record.description,
      endpointUrl: record.endpointUrl,
      headerName: record.headerName,
      hasToken: Boolean(secrets.token),
      maskedToken: maskSecret(secrets.token),
      hasWebhookSecret: Boolean(secrets.webhookSecret),
      maskedWebhookSecret: maskSecret(secrets.webhookSecret),
      hasHeaderValue: Boolean(secrets.headerValue),
      maskedHeaderValue: maskSecret(secrets.headerValue),
      extraKeys,
      extraMasked,
      metadata: { ...record.metadata },
      enabled: record.enabled,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  private findInternal(idOrName: string): ConnectionRecordInternal | undefined {
    const direct = this.records.get(idOrName);
    if (direct) return direct;
    const lowered = idOrName.trim().toLowerCase();
    for (const rec of this.records.values()) {
      if (rec.name.toLowerCase() === lowered || rec.id.toLowerCase() === lowered) {
        return rec;
      }
    }
    return undefined;
  }

  listPublic(): ConnectionPublic[] {
    return Array.from(this.records.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => this.toPublic(r));
  }

  getPublic(idOrName: string): ConnectionPublic | null {
    const rec = this.findInternal(idOrName);
    return rec ? this.toPublic(rec) : null;
  }

  upsertConnection(input: UpsertConnectionInput): ConnectionPublic {
    const cleanName = input.name.trim();
    if (!cleanName) {
      throw new Error('Connection name is required');
    }

    const existing = input.id ? this.findInternal(input.id) : this.findInternal(cleanName);
    const now = new Date().toISOString();

    let targetId = existing?.id ?? slugifyId(input.id || cleanName);
    if (!existing) {
      let suffix = 2;
      while (this.records.has(targetId)) {
        targetId = `${slugifyId(cleanName)}_${suffix++}`;
      }
    }

    // Ensure unique reference name among other records
    for (const other of this.records.values()) {
      if (other.id !== targetId && other.name.toLowerCase() === cleanName.toLowerCase()) {
        throw new Error(`A connection named "${cleanName}" already exists`);
      }
    }

    const prevSecrets = existing ? this.decryptPayload(existing) : { extra: {} };
    const nextSecrets: EncryptedConnectionPayload = {
      token: prevSecrets.token,
      webhookSecret: prevSecrets.webhookSecret,
      headerValue: prevSecrets.headerValue,
      extra: { ...(prevSecrets.extra ?? {}) }
    };

    if (input.clearToken) {
      delete nextSecrets.token;
    } else if (typeof input.token === 'string' && input.token.trim().length > 0) {
      nextSecrets.token = input.token.trim();
    }

    if (input.clearWebhookSecret) {
      delete nextSecrets.webhookSecret;
    } else if (typeof input.webhookSecret === 'string' && input.webhookSecret.trim().length > 0) {
      nextSecrets.webhookSecret = input.webhookSecret.trim();
    }

    if (input.clearHeaderValue) {
      delete nextSecrets.headerValue;
    } else if (typeof input.headerValue === 'string' && input.headerValue.trim().length > 0) {
      nextSecrets.headerValue = input.headerValue.trim();
    }

    if (Array.isArray(input.keepExtraKeys)) {
      const kept = new Set(input.keepExtraKeys);
      for (const k of Object.keys(nextSecrets.extra ?? {})) {
        if (!kept.has(k)) {
          delete nextSecrets.extra![k];
        }
      }
    }
    if (input.extra && typeof input.extra === 'object') {
      for (const [k, v] of Object.entries(input.extra)) {
        const cleanKey = k.trim();
        if (!cleanKey) continue;
        if (typeof v === 'string' && v.trim().length > 0) {
          nextSecrets.extra![cleanKey] = v.trim();
        }
      }
    }

    const category: ConnectionCategory = input.category ?? existing?.category ?? 'custom';
    const preset = CONNECTION_PRESETS.find(p => p.category === category);
    const nextMetadata: Record<string, string> = {};
    const sourceMeta = input.metadata ?? existing?.metadata ?? {};
    for (const [k, v] of Object.entries(sourceMeta)) {
      const ck = k.trim();
      if (ck && typeof v === 'string' && v.trim() !== '') {
        nextMetadata[ck] = v.trim();
      }
    }

    const endpointUrl =
      input.endpointUrl !== undefined
        ? input.endpointUrl.trim()
        : existing?.endpointUrl ?? preset?.defaultEndpointUrl ?? '';

    const record: ConnectionRecordInternal = {
      id: targetId,
      name: cleanName,
      label: input.label?.trim() || existing?.label || cleanName,
      category,
      description: input.description !== undefined ? input.description.trim() : existing?.description ?? '',
      endpointUrl,
      headerName:
        input.headerName !== undefined
          ? input.headerName.trim()
          : existing?.headerName ?? preset?.defaultHeaderName ?? '',
      encryptedPayload: this.vault.encrypt({ ...nextSecrets }),
      metadata: nextMetadata,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.records.set(record.id, record);
    return this.toPublic(record);
  }

  deleteConnection(idOrName: string): boolean {
    const rec = this.findInternal(idOrName);
    if (!rec) return false;
    return this.records.delete(rec.id);
  }

  private resolveInternal(rec: ConnectionRecordInternal): ResolvedConnection {
    const secrets = this.decryptPayload(rec);
    const primaryValue = secrets.token || rec.endpointUrl || secrets.webhookSecret || secrets.headerValue || null;
    const headers: Record<string, string> = {};

    if (rec.headerName && secrets.headerValue) {
      headers[rec.headerName] = secrets.headerValue;
    } else if (rec.headerName && secrets.token) {
      if (rec.headerName.toLowerCase() === 'authorization' && !secrets.token.toLowerCase().startsWith('bearer ')) {
        headers[rec.headerName] = `Bearer ${secrets.token}`;
      } else {
        headers[rec.headerName] = secrets.token;
      }
    } else if (rec.category === 'github' && secrets.token) {
      headers['Authorization'] = `Bearer ${secrets.token}`;
      headers['Accept'] = 'application/vnd.github+json';
    }

    return {
      id: rec.id,
      name: rec.name,
      label: rec.label,
      category: rec.category,
      url: rec.endpointUrl,
      webhook_url: rec.endpointUrl,
      token: secrets.token ?? null,
      value: primaryValue,
      secret: secrets.webhookSecret ?? secrets.token ?? null,
      webhook_secret: secrets.webhookSecret ?? null,
      header_name: rec.headerName,
      header_value: secrets.headerValue ?? null,
      headers,
      metadata: { ...rec.metadata },
      extra: { ...(secrets.extra ?? {}) }
    };
  }

  getResolved(idOrName: string): ResolvedConnection | null {
    const rec = this.findInternal(idOrName);
    if (!rec || !rec.enabled) return null;
    return this.resolveInternal(rec);
  }

  findByCategory(category: string): ResolvedConnection | null {
    const lower = category.trim().toLowerCase();
    for (const rec of this.records.values()) {
      if (rec.enabled && rec.category.toLowerCase() === lower) {
        return this.resolveInternal(rec);
      }
    }
    return null;
  }

  listMetadataForLua(category?: string): Array<Record<string, unknown>> {
    const lower = category?.trim().toLowerCase();
    return Array.from(this.records.values())
      .filter(r => r.enabled && (!lower || r.category.toLowerCase() === lower))
      .map(r => {
        const pub = this.toPublic(r);
        return {
          id: pub.id,
          name: pub.name,
          label: pub.label,
          category: pub.category,
          url: pub.endpointUrl,
          has_token: pub.hasToken,
          has_webhook_secret: pub.hasWebhookSecret,
          metadata: pub.metadata,
          extra_keys: pub.extraKeys
        };
      });
  }

  getSecretsMapContributions(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const rec of this.records.values()) {
      if (!rec.enabled) continue;
      const resolved = this.resolveInternal(rec);
      out[rec.name] = {
        value: resolved.value,
        token: resolved.token,
        url: resolved.url,
        webhook_url: resolved.webhook_url,
        secret: resolved.secret,
        webhook_secret: resolved.webhook_secret,
        header_name: resolved.header_name,
        header_value: resolved.header_value,
        headers: resolved.headers,
        category: resolved.category,
        ...resolved.metadata,
        ...resolved.extra
      };
    }
    return out;
  }

  async testConnection(
    idOrName: string,
    opts: { sendPing?: boolean; pingMessage?: string } = {}
  ): Promise<ConnectionTestResult> {
    const started = Date.now();
    const rec = this.findInternal(idOrName);
    if (!rec) {
      return {
        ok: false,
        category: 'custom',
        message: `Connection "${idOrName}" not found`,
        latencyMs: Date.now() - started
      };
    }

    const resolved = this.resolveInternal(rec);

    if (rec.category === 'telegram') {
      if (!resolved.token) {
        return {
          ok: false,
          category: 'telegram',
          message: 'No Telegram Bot Token is saved on this connection yet.',
          latencyMs: Date.now() - started
        };
      }
      const apiBase = (resolved.url || 'https://api.telegram.org').replace(/\/+$/, '');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      try {
        const resp = await fetch(`${apiBase}/bot${resolved.token}/getMe`, {
          method: 'GET',
          signal: ac.signal
        });
        const data = (await resp.json().catch(() => null)) as {
          ok?: boolean;
          description?: string;
          result?: { id?: number; username?: string; first_name?: string; can_join_groups?: boolean };
        } | null;
        if (!resp.ok || !data?.ok || !data.result) {
          return {
            ok: false,
            category: 'telegram',
            statusCode: resp.status,
            message: data?.description || `Telegram API returned HTTP ${resp.status}`,
            latencyMs: Date.now() - started
          };
        }
        return {
          ok: true,
          category: 'telegram',
          statusCode: resp.status,
          message: `Connected to Telegram bot @${data.result.username ?? 'unknown'} (${data.result.first_name ?? 'Bot'})`,
          latencyMs: Date.now() - started,
          details: data.result as Record<string, unknown>
        };
      } catch (err) {
        return {
          ok: false,
          category: 'telegram',
          message: `Telegram request failed: ${(err as Error).message}`,
          latencyMs: Date.now() - started
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (rec.category === 'github' && resolved.token && opts.sendPing) {
      const apiBase = (resolved.url || 'https://api.github.com').replace(/\/+$/, '');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      try {
        const resp = await fetch(`${apiBase}/user`, {
          headers: {
            Authorization: `Bearer ${resolved.token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Poseidon-Workflow-Engine'
          },
          signal: ac.signal
        });
        const data = (await resp.json().catch(() => null)) as { login?: string; message?: string } | null;
        return {
          ok: resp.ok,
          category: 'github',
          statusCode: resp.status,
          message: resp.ok
            ? `Authenticated GitHub user: @${data?.login ?? 'verified'}`
            : data?.message || `GitHub API returned HTTP ${resp.status}`,
          latencyMs: Date.now() - started
        };
      } catch (err) {
        return {
          ok: false,
          category: 'github',
          message: `GitHub test failed: ${(err as Error).message}`,
          latencyMs: Date.now() - started
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (resolved.url) {
      try {
        new URL(resolved.url);
      } catch {
        return {
          ok: false,
          category: rec.category,
          message: `Invalid endpoint URL: "${resolved.url}"`,
          latencyMs: Date.now() - started
        };
      }
    }

    if (opts.sendPing) {
      if (!resolved.url) {
        return {
          ok: false,
          category: rec.category,
          message: 'Cannot send test ping without an Endpoint / Webhook URL.',
          latencyMs: Date.now() - started
        };
      }
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      try {
        const msg = opts.pingMessage || `Poseidon test ping for "${rec.name}" at ${new Date().toISOString()}`;
        const bodyObj =
          rec.category === 'discord'
            ? { content: msg }
            : { text: msg, source: 'poseidon', connection: rec.name };
        const resp = await fetch(resolved.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...resolved.headers
          },
          body: JSON.stringify(bodyObj),
          signal: ac.signal
        });
        return {
          ok: resp.ok,
          category: rec.category,
          statusCode: resp.status,
          message: resp.ok
            ? `Webhook ping delivered (HTTP ${resp.status}).`
            : `Webhook returned HTTP ${resp.status}.`,
          latencyMs: Date.now() - started
        };
      } catch (err) {
        return {
          ok: false,
          category: rec.category,
          message: `Webhook ping failed: ${(err as Error).message}`,
          latencyMs: Date.now() - started
        };
      } finally {
        clearTimeout(timer);
      }
    }

    const parts: string[] = [];
    if (resolved.url) parts.push('URL valid');
    if (resolved.token) parts.push('token encrypted');
    if (resolved.webhook_secret) parts.push('webhook secret encrypted');
    if (Object.keys(resolved.extra).length > 0) parts.push(`${Object.keys(resolved.extra).length} extra secret(s)`);

    return {
      ok: Boolean(resolved.url || resolved.token || resolved.webhook_secret || Object.keys(resolved.extra).length > 0),
      category: rec.category,
      message:
        parts.length > 0
          ? `Connection "${rec.name}" verified (${parts.join(', ')}).`
          : `Connection "${rec.name}" has no URL or token saved yet.`,
      latencyMs: Date.now() - started
    };
  }

  async inspectTelegramWebhook(idOrName: string): Promise<{
    ok: boolean;
    message: string;
    webhook?: Record<string, unknown>;
  }> {
    const rec = this.findInternal(idOrName);
    if (!rec || rec.category !== 'telegram') {
      return { ok: false, message: 'Telegram connection not found' };
    }
    const resolved = this.resolveInternal(rec);
    if (!resolved.token) {
      return { ok: false, message: 'Telegram Bot Token is required' };
    }
    const apiBase = (resolved.url || 'https://api.telegram.org').replace(/\/+$/, '');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      const resp = await fetch(`${apiBase}/bot${resolved.token}/getWebhookInfo`, { signal: ac.signal });
      const data = (await resp.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
        result?: Record<string, unknown>;
      } | null;
      if (!resp.ok || !data?.ok) {
        return { ok: false, message: data?.description || `HTTP ${resp.status}` };
      }
      const url = String(data.result?.url ?? '');
      return {
        ok: true,
        message: url ? `Active Telegram webhook: ${url}` : 'No Telegram webhook currently set (polling mode).',
        webhook: data.result
      };
    } catch (err) {
      return { ok: false, message: `Telegram getWebhookInfo failed: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async setTelegramWebhook(
    idOrName: string,
    webhookUrl: string,
    dropPendingUpdates = false
  ): Promise<{ ok: boolean; message: string }> {
    const rec = this.findInternal(idOrName);
    if (!rec || rec.category !== 'telegram') {
      return { ok: false, message: 'Telegram connection not found' };
    }
    const resolved = this.resolveInternal(rec);
    if (!resolved.token) {
      return { ok: false, message: 'Telegram Bot Token is required' };
    }
    const apiBase = (resolved.url || 'https://api.telegram.org').replace(/\/+$/, '');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      const payload: Record<string, unknown> = {
        url: webhookUrl.trim(),
        drop_pending_updates: dropPendingUpdates
      };
      if (resolved.webhook_secret && webhookUrl.trim()) {
        payload.secret_token = resolved.webhook_secret;
      }
      const method = webhookUrl.trim() ? 'setWebhook' : 'deleteWebhook';
      const resp = await fetch(`${apiBase}/bot${resolved.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookUrl.trim() ? payload : { drop_pending_updates: dropPendingUpdates }),
        signal: ac.signal
      });
      const data = (await resp.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!resp.ok || !data?.ok) {
        return { ok: false, message: data?.description || `HTTP ${resp.status}` };
      }
      return {
        ok: true,
        message: webhookUrl.trim()
          ? `Telegram webhook registered: ${webhookUrl.trim()}`
          : 'Telegram webhook deleted (switched back to polling mode).'
      };
    } catch (err) {
      return { ok: false, message: `Telegram ${webhookUrl.trim() ? 'setWebhook' : 'deleteWebhook'} failed: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
