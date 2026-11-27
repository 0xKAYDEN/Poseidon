import type { CredentialVault } from './crypto.js';

export type AiProtocolFormat =
  | 'openai_compatible'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'azure_openai'
  | 'cohere'
  | 'custom_json';

export type AiAuthType =
  | 'bearer'
  | 'x-api-key'
  | 'api-key'
  | 'x-goog-api-key'
  | 'header'
  | 'query_param'
  | 'none';

export interface AiProviderPreset {
  presetId: string;
  name: string;
  description: string;
  apiFormat: AiProtocolFormat;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  authType: AiAuthType;
  authHeaderName?: string;
  authPrefix?: string;
  apiKeyParamName?: string;
  apiVersion?: string;
  requiresApiKey: boolean;
  envKeys: string[];
  envUrlKeys?: string[];
  docsHint: string;
}

export interface AiProviderRecord {
  id: string;
  name: string;
  presetId: string;
  isCustom: boolean;
  apiFormat: AiProtocolFormat;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  authType: AiAuthType;
  authHeaderName: string;
  authPrefix: string;
  apiKeyParamName: string;
  apiVersion: string;
  customHeaders: Record<string, string>;
  customBodyTemplate: Record<string, unknown>;
  responsePath: string;
  enabled: boolean;
  isDefault: boolean;
  requiresApiKey: boolean;
  encryptedApiKey: string | null;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderPublic {
  id: string;
  name: string;
  presetId: string;
  isCustom: boolean;
  apiFormat: AiProtocolFormat;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  authType: AiAuthType;
  authHeaderName: string;
  authPrefix: string;
  apiKeyParamName: string;
  apiVersion: string;
  customHeaders: Record<string, string>;
  customBodyTemplate: Record<string, unknown>;
  responsePath: string;
  enabled: boolean;
  isDefault: boolean;
  requiresApiKey: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatMessage {
  role: string;
  content: string;
}

export interface AiChatRequest {
  provider?: string;
  provider_id?: string;
  model?: string;
  messages?: unknown;
  prompt?: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
  base_url?: string;
  url?: string;
  api_key?: string;
  api_format?: AiProtocolFormat;
  auth_type?: AiAuthType;
  auth_header_name?: string;
  auth_prefix?: string;
  headers?: Record<string, unknown>;
  response_path?: string;
  body_extra?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface AiChatResponse {
  ok: boolean;
  content: string;
  model: string;
  provider: string;
  provider_name: string;
  api_format: AiProtocolFormat;
  stub: boolean;
  latency_ms: number;
  finish_reason?: string;
  usage?: Record<string, unknown>;
  status_code?: number;
  error?: string;
}

export interface AiEmbedResponse {
  ok: boolean;
  embeddings: number[][];
  embedding: number[];
  dimensions: number;
  model: string;
  provider: string;
  stub: boolean;
  latency_ms: number;
  error?: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    presetId: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4.1, o3-mini, and OpenAI embeddings',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o3-mini', 'text-embedding-3-small'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['POSEIDON_AI_API_KEY', 'OPENAI_API_KEY', 'POSEIDON_OPENAI_API_KEY'],
    envUrlKeys: ['POSEIDON_AI_URL', 'OPENAI_BASE_URL'],
    docsHint: 'Uses Bearer token against /v1/chat/completions and /v1/embeddings.'
  },
  {
    presetId: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Claude Sonnet 4, Claude 3.7 Sonnet, and Claude 3.5 Haiku',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
    authType: 'x-api-key',
    requiresApiKey: true,
    envKeys: ['ANTHROPIC_API_KEY', 'POSEIDON_ANTHROPIC_API_KEY'],
    docsHint: 'Uses x-api-key and anthropic-version: 2023-06-01 against /v1/messages.'
  },
  {
    presetId: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 2.5 Flash, Gemini 2.5 Pro, and text-embedding-004',
    apiFormat: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'text-embedding-004'],
    authType: 'x-goog-api-key',
    requiresApiKey: true,
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'POSEIDON_GEMINI_API_KEY'],
    docsHint: 'Uses x-goog-api-key header against :generateContent and :embedContent.'
  },
  {
    presetId: 'groq',
    name: 'Groq',
    description: 'Ultra-fast LPU inference for Llama 3.3, Qwen, and DeepSeek R1 Distill',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b', 'deepseek-r1-distill-llama-70b'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['GROQ_API_KEY', 'POSEIDON_GROQ_API_KEY'],
    docsHint: 'OpenAI-compatible endpoint hosted at api.groq.com/openai/v1.'
  },
  {
    presetId: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified gateway to 200+ models across OpenAI, Anthropic, Google, and Meta',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      'openrouter/free',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.3-70b-instruct:free'
    ],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['OPENROUTER_API_KEY', 'POSEIDON_OPENROUTER_API_KEY'],
    docsHint: 'Supports optional HTTP-Referer and X-Title custom headers.'
  },
  {
    presetId: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek-V3 chat and DeepSeek-R1 reasoning models',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['DEEPSEEK_API_KEY', 'POSEIDON_DEEPSEEK_API_KEY'],
    docsHint: 'OpenAI-compatible API at api.deepseek.com/v1.'
  },
  {
    presetId: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral Large, Mistral Small, Codestral, and Mistral Embed',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-large-latest', 'codestral-latest', 'mistral-embed'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['MISTRAL_API_KEY', 'POSEIDON_MISTRAL_API_KEY'],
    docsHint: 'OpenAI-compatible endpoint at api.mistral.ai/v1.'
  },
  {
    presetId: 'xai',
    name: 'xAI (Grok)',
    description: 'Grok 3 Mini and Grok 2 language models',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    models: ['grok-3-mini', 'grok-2-latest'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['XAI_API_KEY', 'POSEIDON_XAI_API_KEY'],
    docsHint: 'OpenAI-compatible endpoint at api.x.ai/v1.'
  },
  {
    presetId: 'together',
    name: 'Together AI',
    description: 'Serverless open-weights Llama, Qwen, and Mixtral inference',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['TOGETHER_API_KEY', 'POSEIDON_TOGETHER_API_KEY'],
    docsHint: 'OpenAI-compatible API at api.together.xyz/v1.'
  },
  {
    presetId: 'cohere',
    name: 'Cohere',
    description: 'Command A, Command R+, and multilingual embeddings',
    apiFormat: 'cohere',
    baseUrl: 'https://api.cohere.com/v2',
    defaultModel: 'command-a-03-2025',
    models: ['command-a-03-2025', 'command-r-plus-08-2024', 'embed-v4.0'],
    authType: 'bearer',
    requiresApiKey: true,
    envKeys: ['COHERE_API_KEY', 'POSEIDON_COHERE_API_KEY'],
    docsHint: 'Uses Cohere v2 /chat and /embed API.'
  },
  {
    presetId: 'ollama',
    name: 'Ollama (Local)',
    description: 'Local & self-hosted open models (no API key required)',
    apiFormat: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'qwen2.5-coder:7b', 'mistral', 'deepseek-r1:8b', 'nomic-embed-text'],
    authType: 'none',
    requiresApiKey: false,
    envKeys: [],
    envUrlKeys: ['OLLAMA_BASE_URL', 'OLLAMA_HOST'],
    docsHint: 'Connects to local or LAN Ollama server via /api/chat, /api/embed, and /api/tags.'
  },
  {
    presetId: 'azure_openai',
    name: 'Azure OpenAI',
    description: 'Deployment-scoped Azure OpenAI Service endpoint',
    apiFormat: 'azure_openai',
    baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
    authType: 'api-key',
    apiVersion: '2024-10-21',
    requiresApiKey: true,
    envKeys: ['AZURE_OPENAI_API_KEY'],
    envUrlKeys: ['AZURE_OPENAI_ENDPOINT'],
    docsHint: 'Uses api-key header and ?api-version= query parameter.'
  },
  {
    presetId: 'custom',
    name: 'Custom Provider',
    description: 'Connect any custom gateway, vLLM, LiteLLM, LM Studio, or proprietary HTTP JSON AI endpoint',
    apiFormat: 'openai_compatible',
    baseUrl: 'https://api.example.com/v1',
    defaultModel: 'custom-model',
    models: ['custom-model'],
    authType: 'bearer',
    authHeaderName: 'Authorization',
    authPrefix: 'Bearer ',
    apiKeyParamName: 'key',
    requiresApiKey: false,
    envKeys: [],
    docsHint: 'Supports OpenAI-compatible, Anthropic, Gemini, Ollama, Cohere, or arbitrary Custom JSON payload/path extraction.'
  }
];

function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function slugifyId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `custom-${Date.now().toString(36)}`;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function getByPath(obj: unknown, pathExpr: string): unknown {
  if (!pathExpr.trim()) return undefined;
  const segments = pathExpr
    .trim()
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function autoExtractText(parsed: unknown, preferredPath?: string): string {
  if (preferredPath) {
    const picked = getByPath(parsed, preferredPath);
    if (typeof picked === 'string') return picked;
    if (picked !== undefined && picked !== null) return JSON.stringify(picked);
  }
  const commonPaths = [
    'choices.0.message.content',
    'choices.0.text',
    'content.0.text',
    'message.content',
    'message.content.0.text',
    'candidates.0.content.parts.0.text',
    'output.text',
    'output',
    'response',
    'reply',
    'content',
    'text',
    'answer',
    'result'
  ];
  for (const path of commonPaths) {
    const val = getByPath(parsed, path);
    if (typeof val === 'string' && val.length > 0) return val;
  }
  if (typeof parsed === 'string') return parsed;
  return JSON.stringify(parsed);
}

function extractMessages(request: AiChatRequest): AiChatMessage[] {
  const out: AiChatMessage[] = [];
  if (request.system && String(request.system).trim()) {
    out.push({ role: 'system', content: String(request.system) });
  }
  const raw = request.messages;
  if (Array.isArray(raw)) {
    for (const m of raw) {
      if (m && typeof m === 'object') {
        const rec = m as Record<string, unknown>;
        out.push({ role: String(rec.role ?? 'user'), content: String(rec.content ?? '') });
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const m of Object.values(raw as Record<string, unknown>)) {
      if (m && typeof m === 'object') {
        const rec = m as Record<string, unknown>;
        out.push({ role: String(rec.role ?? 'user'), content: String(rec.content ?? '') });
      }
    }
  }
  if (out.length === 0 && request.prompt !== undefined) {
    out.push({ role: 'user', content: String(request.prompt) });
  }
  return out;
}

function buildStubEmbedding(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = (code * 31 + i * 17) % dims;
    const sign = (code + i) % 2 === 0 ? 1 : -1;
    vec[idx] += sign * (1 + (code % 7) * 0.15);
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map(v => Number((v / norm).toFixed(6)));
}

export interface UpsertAiProviderInput {
  id?: string;
  name: string;
  presetId?: string;
  isCustom?: boolean;
  apiFormat?: AiProtocolFormat;
  baseUrl?: string;
  defaultModel?: string;
  models?: string[];
  authType?: AiAuthType;
  authHeaderName?: string;
  authPrefix?: string;
  apiKeyParamName?: string;
  apiVersion?: string;
  customHeaders?: Record<string, string>;
  customBodyTemplate?: Record<string, unknown>;
  responsePath?: string;
  enabled?: boolean;
  isDefault?: boolean;
  requiresApiKey?: boolean;
  apiKey?: string | null;
  clearApiKey?: boolean;
  timeoutMs?: number;
}

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProviderRecord>();

  constructor(private readonly vault: CredentialVault) {
    this.seedDefaults();
  }

  private encryptKey(raw: string | null | undefined): string | null {
    const trimmed = raw?.trim();
    if (!trimmed) return null;
    return this.vault.encrypt({ apiKey: trimmed });
  }

  private decryptKey(encrypted: string | null): string | null {
    if (!encrypted) return null;
    try {
      const data = this.vault.decrypt(encrypted);
      return typeof data.apiKey === 'string' ? data.apiKey : null;
    } catch {
      return null;
    }
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();
    let defaultAssigned = false;

    const corePresets = ['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'deepseek', 'mistral', 'xai', 'ollama'];

    for (const presetId of corePresets) {
      const preset = AI_PROVIDER_PRESETS.find(p => p.presetId === presetId);
      if (!preset) continue;

      let resolvedKey: string | null = null;
      for (const envName of preset.envKeys) {
        const val = process.env[envName]?.trim();
        if (val) {
          resolvedKey = val;
          break;
        }
      }

      let resolvedUrl = preset.baseUrl;
      if (preset.envUrlKeys) {
        for (const envUrl of preset.envUrlKeys) {
          const val = process.env[envUrl]?.trim();
          if (val) {
            resolvedUrl = val;
            break;
          }
        }
      }

      const isPoseidonEnvCustom =
        presetId === 'openai' &&
        Boolean(process.env.POSEIDON_AI_URL?.trim()) &&
        !process.env.POSEIDON_AI_URL!.includes('api.openai.com');

      const shouldBeDefault = !defaultAssigned && Boolean(resolvedKey);
      if (shouldBeDefault) defaultAssigned = true;

      const record: AiProviderRecord = {
        id: preset.presetId,
        name: isPoseidonEnvCustom ? 'Configured OpenAI-Compatible' : preset.name,
        presetId: preset.presetId,
        isCustom: false,
        apiFormat: preset.apiFormat,
        baseUrl: normalizeBaseUrl(resolvedUrl),
        defaultModel: preset.defaultModel,
        models: [...preset.models],
        authType: preset.authType,
        authHeaderName: preset.authHeaderName ?? 'Authorization',
        authPrefix: preset.authPrefix ?? 'Bearer ',
        apiKeyParamName: preset.apiKeyParamName ?? 'key',
        apiVersion: preset.apiVersion ?? '2024-10-21',
        customHeaders: {},
        customBodyTemplate: {},
        responsePath: '',
        enabled: true,
        isDefault: shouldBeDefault,
        requiresApiKey: preset.requiresApiKey,
        encryptedApiKey: this.encryptKey(resolvedKey),
        timeoutMs: 30_000,
        createdAt: now,
        updatedAt: now
      };
      this.providers.set(record.id, record);
    }

    if (!defaultAssigned && this.providers.has('openai')) {
      this.providers.get('openai')!.isDefault = true;
    }
  }

  getPresets(): AiProviderPreset[] {
    return AI_PROVIDER_PRESETS;
  }

  private toPublic(rec: AiProviderRecord): AiProviderPublic {
    const plain = this.decryptKey(rec.encryptedApiKey);
    return {
      id: rec.id,
      name: rec.name,
      presetId: rec.presetId,
      isCustom: rec.isCustom,
      apiFormat: rec.apiFormat,
      baseUrl: rec.baseUrl,
      defaultModel: rec.defaultModel,
      models: rec.models,
      authType: rec.authType,
      authHeaderName: rec.authHeaderName,
      authPrefix: rec.authPrefix,
      apiKeyParamName: rec.apiKeyParamName,
      apiVersion: rec.apiVersion,
      customHeaders: rec.customHeaders,
      customBodyTemplate: rec.customBodyTemplate,
      responsePath: rec.responsePath,
      enabled: rec.enabled,
      isDefault: rec.isDefault,
      requiresApiKey: rec.requiresApiKey,
      hasApiKey: Boolean(plain),
      maskedApiKey: plain ? maskSecret(plain) : null,
      timeoutMs: rec.timeoutMs,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    };
  }

  listPublic(): AiProviderPublic[] {
    return Array.from(this.providers.values()).map(p => this.toPublic(p));
  }

  getPublic(id: string): AiProviderPublic | null {
    const found = this.resolveProviderRecord(id);
    return found ? this.toPublic(found) : null;
  }

  resolveProviderRecord(identifier?: string): AiProviderRecord | null {
    if (identifier && identifier.trim()) {
      const needle = identifier.trim().toLowerCase();
      if (this.providers.has(needle)) return this.providers.get(needle)!;
      for (const rec of this.providers.values()) {
        if (
          rec.id.toLowerCase() === needle ||
          rec.name.toLowerCase() === needle ||
          rec.presetId.toLowerCase() === needle
        ) {
          return rec;
        }
      }
      return null;
    }
    for (const rec of this.providers.values()) {
      if (rec.isDefault && rec.enabled) return rec;
    }
    for (const rec of this.providers.values()) {
      if (rec.enabled) return rec;
    }
    return this.providers.values().next().value ?? null;
  }

  upsertProvider(input: UpsertAiProviderInput): AiProviderPublic {
    const now = new Date().toISOString();
    const preset = AI_PROVIDER_PRESETS.find(p => p.presetId === (input.presetId || 'custom'));
    const rawId = input.id ? slugifyId(input.id) : slugifyId(input.name);
    const existing = this.providers.get(rawId);

    if (input.isDefault) {
      for (const rec of this.providers.values()) rec.isDefault = false;
    }

    let encryptedApiKey = existing?.encryptedApiKey ?? null;
    if (input.clearApiKey) {
      encryptedApiKey = null;
    } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      encryptedApiKey = this.encryptKey(input.apiKey);
    }

    const modelsList =
      Array.isArray(input.models) && input.models.length > 0
        ? input.models.map(m => m.trim()).filter(Boolean)
        : existing?.models ?? (preset ? [...preset.models] : ['custom-model']);

    const defaultModel = input.defaultModel?.trim() || existing?.defaultModel || modelsList[0] || 'custom-model';
    if (defaultModel && !modelsList.includes(defaultModel)) {
      modelsList.unshift(defaultModel);
    }

    const authType = input.authType ?? existing?.authType ?? preset?.authType ?? 'bearer';
    const requiresApiKey =
      input.requiresApiKey !== undefined
        ? input.requiresApiKey
        : authType !== 'none' && (existing?.requiresApiKey ?? preset?.requiresApiKey ?? false);

    const record: AiProviderRecord = {
      id: rawId,
      name: input.name.trim() || existing?.name || preset?.name || rawId,
      presetId: input.presetId ?? existing?.presetId ?? 'custom',
      isCustom: input.isCustom ?? existing?.isCustom ?? ((input.presetId ?? 'custom') === 'custom'),
      apiFormat: input.apiFormat ?? existing?.apiFormat ?? preset?.apiFormat ?? 'openai_compatible',
      baseUrl: normalizeBaseUrl(input.baseUrl ?? existing?.baseUrl ?? preset?.baseUrl ?? ''),
      defaultModel,
      models: modelsList,
      authType,
      authHeaderName: input.authHeaderName ?? existing?.authHeaderName ?? preset?.authHeaderName ?? 'Authorization',
      authPrefix: input.authPrefix ?? existing?.authPrefix ?? preset?.authPrefix ?? 'Bearer ',
      apiKeyParamName: input.apiKeyParamName ?? existing?.apiKeyParamName ?? preset?.apiKeyParamName ?? 'key',
      apiVersion: input.apiVersion ?? existing?.apiVersion ?? preset?.apiVersion ?? '2024-10-21',
      customHeaders: input.customHeaders ?? existing?.customHeaders ?? {},
      customBodyTemplate: input.customBodyTemplate ?? existing?.customBodyTemplate ?? {},
      responsePath: input.responsePath ?? existing?.responsePath ?? '',
      enabled: input.enabled ?? existing?.enabled ?? true,
      isDefault: input.isDefault ?? existing?.isDefault ?? false,
      requiresApiKey,
      encryptedApiKey,
      timeoutMs: Math.max(1000, Math.min(180_000, input.timeoutMs ?? existing?.timeoutMs ?? 30_000)),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.providers.set(record.id, record);
    return this.toPublic(record);
  }

  setDefault(id: string): AiProviderPublic | null {
    const target = this.resolveProviderRecord(id);
    if (!target) return null;
    for (const rec of this.providers.values()) {
      rec.isDefault = rec.id === target.id;
    }
    target.enabled = true;
    target.updatedAt = new Date().toISOString();
    return this.toPublic(target);
  }

  deleteProvider(id: string): boolean {
    const target = this.providers.get(id);
    if (!target) return false;
    const wasDefault = target.isDefault;
    this.providers.delete(id);
    if (wasDefault) {
      const next = this.providers.values().next().value;
      if (next) next.isDefault = true;
    }
    return true;
  }

  private applyAuth(
    url: string,
    headers: Record<string, string>,
    authType: AiAuthType,
    apiKey: string | null,
    authHeaderName: string,
    authPrefix: string,
    apiKeyParamName: string
  ): string {
    if (!apiKey || authType === 'none') return url;
    switch (authType) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${apiKey}`;
        return url;
      case 'x-api-key':
        headers['x-api-key'] = apiKey;
        return url;
      case 'api-key':
        headers['api-key'] = apiKey;
        return url;
      case 'x-goog-api-key':
        headers['x-goog-api-key'] = apiKey;
        return url;
      case 'header': {
        const hName = authHeaderName.trim() || 'Authorization';
        headers[hName] = `${authPrefix}${apiKey}`;
        return url;
      }
      case 'query_param': {
        const sep = url.includes('?') ? '&' : '?';
        const pName = encodeURIComponent(apiKeyParamName.trim() || 'key');
        return `${url}${sep}${pName}=${encodeURIComponent(apiKey)}`;
      }
      default:
        return url;
    }
  }

  private buildSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
    const timeoutSig = AbortSignal.timeout(timeoutMs);
    if (!externalSignal) return timeoutSig;
    return AbortSignal.any([timeoutSig, externalSignal]);
  }

  async chat(request: AiChatRequest, externalSignal?: AbortSignal): Promise<AiChatResponse> {
    const started = Date.now();
    const messages = extractMessages(request);
    const inlineBaseUrl = request.base_url || request.url;

    let providerRec = this.resolveProviderRecord(request.provider_id ?? request.provider);
    let providerId = providerRec?.id ?? (request.provider || 'custom');
    let providerName = providerRec?.name ?? 'Custom Inline AI';
    let apiFormat: AiProtocolFormat = request.api_format ?? providerRec?.apiFormat ?? 'openai_compatible';
    let baseUrl = normalizeBaseUrl(inlineBaseUrl || providerRec?.baseUrl || 'https://api.openai.com/v1');
    let authType: AiAuthType = request.auth_type ?? providerRec?.authType ?? (inlineBaseUrl ? 'bearer' : 'bearer');
    let authHeaderName = request.auth_header_name ?? providerRec?.authHeaderName ?? 'Authorization';
    let authPrefix = request.auth_prefix ?? providerRec?.authPrefix ?? 'Bearer ';
    let apiKeyParamName = providerRec?.apiKeyParamName ?? 'key';
    let apiVersion = providerRec?.apiVersion ?? '2024-10-21';
    let responsePath = request.response_path ?? providerRec?.responsePath ?? '';
    let requiresApiKey = providerRec?.requiresApiKey ?? (authType !== 'none');
    let apiKey = request.api_key?.trim() || (providerRec ? this.decryptKey(providerRec.encryptedApiKey) : null);
    let model = request.model?.trim() || providerRec?.defaultModel || 'gpt-4o-mini';
    const timeoutMs = request.timeout_ms ?? providerRec?.timeoutMs ?? 30_000;

    if (inlineBaseUrl && !request.provider && !request.provider_id) {
      providerId = 'custom-inline';
      providerName = 'Custom Inline Provider';
      if (!request.api_key) requiresApiKey = false;
    }

    if (providerRec && !providerRec.enabled && !inlineBaseUrl) {
      return {
        ok: false,
        content: `[ai error] Provider "${providerRec.name}" is disabled.`,
        model,
        provider: providerId,
        provider_name: providerName,
        api_format: apiFormat,
        stub: false,
        latency_ms: Date.now() - started,
        error: `Provider "${providerRec.name}" is disabled`
      };
    }

    if (!apiKey && requiresApiKey) {
      const promptSummary = messages.map(m => `${m.role}: ${m.content}`).join('\n');
      return {
        ok: true,
        content: `[stub:${providerId}] I would have answered via ${providerName} (${model}):\n${promptSummary}`,
        model,
        provider: providerId,
        provider_name: providerName,
        api_format: apiFormat,
        stub: true,
        latency_ms: Date.now() - started
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Poseidon-Automation/1.0',
      ...(providerRec?.customHeaders ?? {})
    };
    if (request.headers) {
      for (const [k, v] of Object.entries(request.headers)) {
        headers[k] = String(v ?? '');
      }
    }

    const temperature = request.temperature ?? 0.7;
    const maxTokens = request.max_tokens ?? 1024;
    const extraBody = { ...(providerRec?.customBodyTemplate ?? {}), ...(request.body_extra ?? {}) };

    let endpoint = baseUrl;
    let bodyPayload: Record<string, unknown>;

    switch (apiFormat) {
      case 'anthropic': {
        endpoint = baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`;
        headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
        const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
        const nonSystem = messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
        bodyPayload = {
          model,
          max_tokens: maxTokens,
          temperature,
          ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
          messages: nonSystem.length > 0 ? nonSystem : [{ role: 'user', content: '' }],
          ...extraBody
        };
        break;
      }
      case 'gemini': {
        endpoint = baseUrl.includes(':generateContent')
          ? baseUrl
          : `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
        const systemParts = messages.filter(m => m.role === 'system').map(m => ({ text: m.content }));
        const contents = messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));
        bodyPayload = {
          ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
          contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
          ...extraBody
        };
        break;
      }
      case 'ollama': {
        endpoint = baseUrl.endsWith('/api/chat') ? baseUrl : `${baseUrl}/api/chat`;
        bodyPayload = {
          model,
          messages,
          stream: false,
          options: { temperature, num_predict: maxTokens },
          ...extraBody
        };
        break;
      }
      case 'azure_openai': {
        const clean = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
        endpoint = clean.includes('api-version=')
          ? clean
          : `${clean}${clean.includes('?') ? '&' : '?'}api-version=${encodeURIComponent(apiVersion)}`;
        bodyPayload = {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...extraBody
        };
        break;
      }
      case 'cohere': {
        endpoint = baseUrl.endsWith('/chat') ? baseUrl : `${baseUrl}/chat`;
        bodyPayload = {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...extraBody
        };
        break;
      }
      case 'custom_json': {
        endpoint = baseUrl;
        const promptText = request.prompt ?? messages.map(m => m.content).join('\n');
        bodyPayload = {
          model,
          messages,
          prompt: promptText,
          temperature,
          max_tokens: maxTokens,
          ...extraBody
        };
        break;
      }
      case 'openai_compatible':
      default: {
        endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
        bodyPayload = {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...extraBody
        };
        break;
      }
    }

    const finalUrl = this.applyAuth(endpoint, headers, authType, apiKey, authHeaderName, authPrefix, apiKeyParamName);

    try {
      const resp = await fetch(finalUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: this.buildSignal(timeoutMs, externalSignal)
      });
      const text = await resp.text();
      if (!resp.ok) {
        return {
          ok: false,
          content: `[ai error] HTTP ${resp.status} ${text}`,
          model,
          provider: providerId,
          provider_name: providerName,
          api_format: apiFormat,
          stub: false,
          status_code: resp.status,
          latency_ms: Date.now() - started,
          error: `HTTP ${resp.status}: ${text.slice(0, 300)}`
        };
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {
          ok: true,
          content: text,
          model,
          provider: providerId,
          provider_name: providerName,
          api_format: apiFormat,
          stub: false,
          status_code: resp.status,
          latency_ms: Date.now() - started
        };
      }

      let content = '';
      let resolvedModel = typeof parsed.model === 'string' ? parsed.model : model;
      let finishReason: string | undefined;
      let usage = parsed.usage as Record<string, unknown> | undefined;

      if (apiFormat === 'anthropic') {
        const blocks = Array.isArray(parsed.content) ? (parsed.content as Array<Record<string, unknown>>) : [];
        content = blocks.map(b => String(b.text ?? '')).join('');
        finishReason = typeof parsed.stop_reason === 'string' ? parsed.stop_reason : undefined;
      } else if (apiFormat === 'gemini') {
        const cands = Array.isArray(parsed.candidates) ? (parsed.candidates as Array<Record<string, unknown>>) : [];
        const parts = ((cands[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? [];
        content = parts.map(p => String(p.text ?? '')).join('');
        finishReason = typeof cands[0]?.finishReason === 'string' ? String(cands[0].finishReason) : undefined;
        usage = parsed.usageMetadata as Record<string, unknown> | undefined;
      } else if (apiFormat === 'ollama') {
        const msg = parsed.message as Record<string, unknown> | undefined;
        content = String(msg?.content ?? parsed.response ?? '');
        finishReason = parsed.done ? 'stop' : undefined;
      } else if (apiFormat === 'cohere') {
        const msg = parsed.message as Record<string, unknown> | undefined;
        const blocks = Array.isArray(msg?.content) ? (msg!.content as Array<Record<string, unknown>>) : [];
        content = blocks.map(b => String(b.text ?? '')).join('') || String(parsed.text ?? '');
        finishReason = typeof parsed.finish_reason === 'string' ? parsed.finish_reason : undefined;
      } else if (apiFormat === 'custom_json') {
        content = autoExtractText(parsed, responsePath);
      } else {
        const choices = Array.isArray(parsed.choices) ? (parsed.choices as Array<Record<string, unknown>>) : [];
        const first = choices[0];
        const msg = first?.message as Record<string, unknown> | undefined;
        content = String(msg?.content ?? first?.text ?? autoExtractText(parsed, responsePath));
        finishReason = typeof first?.finish_reason === 'string' ? first.finish_reason : undefined;
      }

      return {
        ok: true,
        content,
        model: resolvedModel,
        provider: providerId,
        provider_name: providerName,
        api_format: apiFormat,
        stub: false,
        status_code: resp.status,
        finish_reason: finishReason,
        usage,
        latency_ms: Date.now() - started
      };
    } catch (err) {
      return {
        ok: false,
        content: `[ai exception] ${(err as Error).message}`,
        model,
        provider: providerId,
        provider_name: providerName,
        api_format: apiFormat,
        stub: false,
        latency_ms: Date.now() - started,
        error: (err as Error).message
      };
    }
  }

  async embed(
    input: string | string[],
    options: { provider?: string; model?: string; base_url?: string; api_key?: string } = {},
    externalSignal?: AbortSignal
  ): Promise<AiEmbedResponse> {
    const started = Date.now();
    const inputs = Array.isArray(input) ? input.map(String) : [String(input)];
    const providerRec = this.resolveProviderRecord(options.provider);
    const providerId = providerRec?.id ?? (options.provider || 'openai');
    const apiFormat = providerRec?.apiFormat ?? 'openai_compatible';
    const baseUrl = normalizeBaseUrl(options.base_url || providerRec?.baseUrl || 'https://api.openai.com/v1');
    const apiKey = options.api_key?.trim() || (providerRec ? this.decryptKey(providerRec.encryptedApiKey) : null);
    const model =
      options.model?.trim() ||
      (apiFormat === 'ollama'
        ? 'nomic-embed-text'
        : apiFormat === 'gemini'
          ? 'text-embedding-004'
          : 'text-embedding-3-small');

    if (!apiKey && (providerRec?.requiresApiKey ?? true)) {
      const embeddings = inputs.map(t => buildStubEmbedding(t));
      return {
        ok: true,
        embeddings,
        embedding: embeddings[0] ?? [],
        dimensions: embeddings[0]?.length ?? 0,
        model,
        provider: providerId,
        stub: true,
        latency_ms: Date.now() - started
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(providerRec?.customHeaders ?? {})
    };
    const authType = providerRec?.authType ?? 'bearer';
    let endpoint = baseUrl;
    let bodyPayload: Record<string, unknown>;

    if (apiFormat === 'ollama') {
      endpoint = `${baseUrl}/api/embed`;
      bodyPayload = { model, input: inputs };
    } else if (apiFormat === 'gemini') {
      endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:embedContent`;
      bodyPayload = {
        model: `models/${model}`,
        content: { parts: [{ text: inputs[0] ?? '' }] }
      };
    } else if (apiFormat === 'cohere') {
      endpoint = `${baseUrl}/embed`;
      bodyPayload = { model, texts: inputs, input_type: 'search_document', embedding_types: ['float'] };
    } else {
      endpoint = baseUrl.endsWith('/embeddings') ? baseUrl : `${baseUrl}/embeddings`;
      bodyPayload = { model, input: inputs };
    }

    const finalUrl = this.applyAuth(
      endpoint,
      headers,
      authType,
      apiKey,
      providerRec?.authHeaderName ?? 'Authorization',
      providerRec?.authPrefix ?? 'Bearer ',
      providerRec?.apiKeyParamName ?? 'key'
    );

    try {
      const resp = await fetch(finalUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: this.buildSignal(providerRec?.timeoutMs ?? 30_000, externalSignal)
      });
      const text = await resp.text();
      if (!resp.ok) {
        return {
          ok: false,
          embeddings: [],
          embedding: [],
          dimensions: 0,
          model,
          provider: providerId,
          stub: false,
          latency_ms: Date.now() - started,
          error: `HTTP ${resp.status}: ${text.slice(0, 300)}`
        };
      }

      const parsed = JSON.parse(text) as Record<string, unknown>;
      let embeddings: number[][] = [];
      if (Array.isArray(parsed.data)) {
        embeddings = (parsed.data as Array<Record<string, unknown>>).map(d =>
          Array.isArray(d.embedding) ? (d.embedding as number[]) : []
        );
      } else if (Array.isArray(parsed.embeddings)) {
        embeddings = parsed.embeddings as number[][];
      } else if (parsed.embedding && typeof parsed.embedding === 'object') {
        const vals = (parsed.embedding as Record<string, unknown>).values;
        if (Array.isArray(vals)) embeddings = [vals as number[]];
      }

      return {
        ok: true,
        embeddings,
        embedding: embeddings[0] ?? [],
        dimensions: embeddings[0]?.length ?? 0,
        model,
        provider: providerId,
        stub: false,
        latency_ms: Date.now() - started
      };
    } catch (err) {
      return {
        ok: false,
        embeddings: [],
        embedding: [],
        dimensions: 0,
        model,
        provider: providerId,
        stub: false,
        latency_ms: Date.now() - started,
        error: (err as Error).message
      };
    }
  }

  async testProvider(id: string): Promise<{
    ok: boolean;
    stub: boolean;
    provider: string;
    model: string;
    latencyMs: number;
    message: string;
    preview?: string;
  }> {
    const rec = this.resolveProviderRecord(id);
    if (!rec) {
      return {
        ok: false,
        stub: false,
        provider: id,
        model: '',
        latencyMs: 0,
        message: `Provider "${id}" not found`
      };
    }

    const res = await this.chat({
      provider: rec.id,
      model: rec.defaultModel,
      messages: [{ role: 'user', content: 'Reply with the single word: PONG' }],
      max_tokens: 24,
      temperature: 0,
      timeout_ms: Math.min(rec.timeoutMs, 12_000)
    });

    if (res.stub) {
      return {
        ok: true,
        stub: true,
        provider: rec.id,
        model: res.model,
        latencyMs: res.latency_ms,
        message: 'No API key configured — verified in simulated stub mode. Add an API key to test live.',
        preview: res.content
      };
    }

    return {
      ok: res.ok,
      stub: false,
      provider: rec.id,
      model: res.model,
      latencyMs: res.latency_ms,
      message: res.ok
        ? `Connected to ${rec.name} (${res.model}) in ${res.latency_ms}ms.`
        : res.error || res.content,
      preview: res.content
    };
  }
}
