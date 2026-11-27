import type {
  AiProtocolFormat,
  AiAuthType,
  AiProviderModel,
  AiProviderPreset,
  AuditLogItem,
  ConnectionCategory,
  ConnectionModel,
  ConnectionPreset,
  ConnectionTestResult,
  ExecutionModel,
  SandboxFileItem,
  ScriptTemplate,
  TableSummary,
  TriggerMode,
  WorkflowModel
} from './types';

export interface SaveConnectionPayload {
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

export interface SaveAiProviderPayload {
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

export class ApiClient {
  private useQueryToken = false;

  constructor(
    private readonly getToken: () => string | null,
    private readonly onUnauthorized?: (usedToken: string) => void
  ) {}

  private appendQueryToken(path: string, token: string): string {
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}__poseidon_token=${encodeURIComponent(token)}`;
  }

  private async request<T>(path: string, init: RequestInit = {}, allowQueryRetry = true): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Poseidon-Token'] = token;
    }

    const usedQueryToken = Boolean(
      token &&
        this.useQueryToken &&
        !path.startsWith('/api/auth/login') &&
        !path.startsWith('/api/auth/register') &&
        !path.startsWith('/api/auth/logout')
    );
    const requestUrl = usedQueryToken ? this.appendQueryToken(path, token!) : path;

    const resp = await fetch(requestUrl, { credentials: 'same-origin', ...init, headers });
    if (resp.status === 204) {
      return undefined as T;
    }
    const text = await resp.text();
    let data: (T & { error?: string }) | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T & { error?: string };
      } catch {
        data = { error: text } as T & { error?: string };
      }
    }
    if (!resp.ok) {
      if (
        resp.status === 401 &&
        allowQueryRetry &&
        !usedQueryToken &&
        token &&
        token === this.getToken() &&
        !path.startsWith('/api/auth/login') &&
        !path.startsWith('/api/auth/register') &&
        !path.startsWith('/api/auth/logout') &&
        (data?.error === 'missing token' || data?.error === 'invalid token')
      ) {
        this.useQueryToken = true;
        return this.request<T>(path, init, false);
      }
      if (
        resp.status === 401 &&
        token &&
        token === this.getToken() &&
        !path.startsWith('/api/auth/login') &&
        !path.startsWith('/api/auth/register') &&
        !path.startsWith('/api/auth/logout')
      ) {
        this.onUnauthorized?.(token);
      }
      throw new Error((data as { error?: string } | null)?.error || `HTTP ${resp.status}`);
    }
    return (data ?? {}) as T;
  }

  getAuthInfo(): Promise<{ defaultUsername: string; hasDefaultDemoPassword: boolean }> {
    return this.request('/api/auth/info');
  }

  login(username: string, password: string): Promise<{ token: string; username: string; role?: string }> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }

  register(username: string, password: string): Promise<{ token: string; username: string; role?: string }> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  getMe(): Promise<{ username: string; role: string }> {
    return this.request('/api/auth/me');
  }

  getScripts(): Promise<ScriptTemplate[]> {
    return this.request('/api/scripts');
  }

  createScriptTemplate(payload: {
    name: string;
    content: string;
    category?: string;
    description?: string;
  }): Promise<ScriptTemplate> {
    return this.request('/api/scripts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  deleteScriptTemplate(id: number): Promise<void> {
    return this.request(`/api/scripts/${id}`, { method: 'DELETE' });
  }

  getWorkflows(): Promise<WorkflowModel[]> {
    return this.request('/api/workflows');
  }

  getWorkflow(id: number): Promise<WorkflowModel> {
    return this.request(`/api/workflows/${id}`);
  }

  createWorkflow(payload: {
    name: string;
    description?: string | null;
    mode: 'blueprint' | 'code';
    trigger_type?: TriggerMode;
    schedule_seconds?: number | null;
    is_active?: boolean;
    nodes: Array<{
      client_id: string;
      type: string;
      name: string;
      script: string;
      x: number;
      y: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      condition: string;
    }>;
  }): Promise<WorkflowModel> {
    return this.request('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  updateWorkflow(
    id: number,
    payload: {
      name?: string;
      description?: string | null;
      mode?: 'blueprint' | 'code';
      trigger_type?: TriggerMode;
      schedule_seconds?: number | null;
      is_active?: boolean;
      nodes?: Array<{
        client_id: string;
        type: string;
        name: string;
        script: string;
        x: number;
        y: number;
      }>;
      edges?: Array<{
        source: string;
        target: string;
        condition: string;
      }>;
    }
  ): Promise<WorkflowModel> {
    return this.request(`/api/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  cloneWorkflow(id: number): Promise<WorkflowModel> {
    return this.request(`/api/workflows/${id}/clone`, { method: 'POST' });
  }

  deleteWorkflow(id: number): Promise<void> {
    return this.request(`/api/workflows/${id}`, { method: 'DELETE' });
  }

  executeWorkflow(
    id: number,
    inputs: Record<string, unknown> = {}
  ): Promise<{ executionId: number; execution: ExecutionModel }> {
    return this.request(`/api/workflows/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ triggerType: 'manual', inputs })
    });
  }

  stopWorkflow(id: number): Promise<{ workflowId: number; stoppedCount: number; executionIds?: number[] }> {
    return this.request(`/api/workflows/${id}/stop`, { method: 'POST' });
  }

  stopExecution(executionId: number): Promise<{ executionId: number; stopped: boolean; status?: string }> {
    return this.request(`/api/executions/${executionId}/stop`, { method: 'POST' });
  }

  stopAllExecutions(): Promise<{ stoppedIds: number[]; stoppedCount: number }> {
    return this.request('/api/executions/stop-all', { method: 'POST' });
  }

  getExecutions(workflowId?: number): Promise<ExecutionModel[]> {
    const qs = workflowId !== undefined ? `?workflowId=${workflowId}` : '';
    return this.request(`/api/executions${qs}`);
  }

  getExecutionDetails(executionId: number): Promise<ExecutionModel & { steps: Array<{
    id: number;
    node_id: number;
    node_name: string;
    status: string;
    output_json: string | null;
    error: string | null;
    duration_ms: number | null;
  }> }> {
    return this.request(`/api/executions/${executionId}`);
  }

  // AI Providers & Custom Connections
  getAiPresets(): Promise<AiProviderPreset[]> {
    return this.request('/api/ai/presets');
  }

  getAiProviders(): Promise<AiProviderModel[]> {
    return this.request('/api/ai/providers');
  }

  saveAiProvider(payload: SaveAiProviderPayload): Promise<AiProviderModel> {
    return this.request('/api/ai/providers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  updateAiProvider(id: string, payload: Partial<SaveAiProviderPayload>): Promise<AiProviderModel> {
    return this.request(`/api/ai/providers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  setDefaultAiProvider(id: string): Promise<AiProviderModel> {
    return this.request(`/api/ai/providers/${encodeURIComponent(id)}/default`, { method: 'POST' });
  }

  testAiProvider(id: string): Promise<{
    ok: boolean;
    stub: boolean;
    provider: string;
    model: string;
    latencyMs: number;
    message: string;
    preview?: string;
  }> {
    return this.request(`/api/ai/providers/${encodeURIComponent(id)}/test`, { method: 'POST' });
  }

  deleteAiProvider(id: string): Promise<void> {
    return this.request(`/api/ai/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  testAiChat(payload: {
    provider?: string;
    model?: string;
    prompt: string;
    system?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<{
    ok: boolean;
    content: string;
    model: string;
    provider: string;
    provider_name: string;
    api_format: AiProtocolFormat;
    stub: boolean;
    latency_ms: number;
    error?: string;
  }> {
    return this.request('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // Database Explorer & SQL Console
  getDbTables(): Promise<TableSummary[]> {
    return this.request('/api/db/tables');
  }

  getDbTableData(tableName: string): Promise<{ meta: TableSummary; rows: Array<Record<string, unknown>> }> {
    return this.request(`/api/db/tables/${encodeURIComponent(tableName)}`);
  }

  createDbTable(name: string, columns: string[]): Promise<TableSummary> {
    return this.request('/api/db/tables', {
      method: 'POST',
      body: JSON.stringify({ name, columns })
    });
  }

  dropDbTable(name: string): Promise<void> {
    return this.request(`/api/db/tables/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  insertDbRow(tableName: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/api/db/tables/${encodeURIComponent(tableName)}/rows`, {
      method: 'POST',
      body: JSON.stringify(row)
    });
  }

  deleteDbRow(tableName: string, rowId: number): Promise<void> {
    return this.request(`/api/db/tables/${encodeURIComponent(tableName)}/rows/${rowId}`, {
      method: 'DELETE'
    });
  }

  runSql(sql: string): Promise<{
    rows: Array<Record<string, unknown>>;
    columns: string[];
    affectedRows: number;
    durationMs: number;
    message?: string;
  }> {
    return this.request('/api/db/query', {
      method: 'POST',
      body: JSON.stringify({ sql })
    });
  }

  // Sandbox FS & Audit
  getSandboxFiles(): Promise<SandboxFileItem[]> {
    return this.request('/api/fs');
  }

  saveSandboxFile(name: string, content: string): Promise<SandboxFileItem> {
    return this.request('/api/fs', {
      method: 'POST',
      body: JSON.stringify({ name, content })
    });
  }

  deleteSandboxFile(name: string): Promise<void> {
    const encodedPath = name
      .split('/')
      .map(seg => encodeURIComponent(seg))
      .join('/');
    return this.request(`/api/fs/${encodedPath}`, { method: 'DELETE' });
  }

  getAuditLogs(): Promise<AuditLogItem[]> {
    return this.request('/api/audit');
  }

  // Credentials
  getCredentials(): Promise<Array<{ id: number; name: string; type: string; created_at: string }>> {
    return this.request('/api/credentials');
  }

  saveCredential(name: string, type: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/credentials', {
      method: 'POST',
      body: JSON.stringify({ name, type, data })
    });
  }

  deleteCredential(id: number): Promise<void> {
    return this.request(`/api/credentials/${id}`, { method: 'DELETE' });
  }

  // Connections (Telegram bots, webhooks, API tokens & custom secrets)
  getConnectionPresets(): Promise<ConnectionPreset[]> {
    return this.request('/api/connections/presets');
  }

  getConnections(): Promise<ConnectionModel[]> {
    return this.request('/api/connections');
  }

  saveConnection(payload: SaveConnectionPayload): Promise<ConnectionModel> {
    return this.request('/api/connections', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  updateConnection(id: string, payload: Partial<SaveConnectionPayload>): Promise<ConnectionModel> {
    return this.request(`/api/connections/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  deleteConnection(id: string): Promise<void> {
    return this.request(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  testConnection(
    id: string,
    opts?: { sendPing?: boolean; pingMessage?: string }
  ): Promise<ConnectionTestResult> {
    return this.request(`/api/connections/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {})
    });
  }

  getTelegramWebhookInfo(id: string): Promise<{ ok: boolean; message: string; webhook?: Record<string, unknown> }> {
    return this.request(`/api/connections/${encodeURIComponent(id)}/telegram/webhook-info`, {
      method: 'POST'
    });
  }

  setTelegramWebhook(
    id: string,
    webhookUrl: string,
    dropPendingUpdates = false
  ): Promise<{ ok: boolean; message: string }> {
    return this.request(`/api/connections/${encodeURIComponent(id)}/telegram/set-webhook`, {
      method: 'POST',
      body: JSON.stringify({ webhookUrl, dropPendingUpdates })
    });
  }
}
