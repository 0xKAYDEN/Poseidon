import type {
  AuditLogItem,
  ExecutionModel,
  SandboxFileItem,
  ScriptTemplate,
  TableSummary,
  TriggerMode,
  WorkflowModel
} from './types';

export class ApiClient {
  constructor(private readonly getToken: () => string | null) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const resp = await fetch(path, { ...init, headers });
    if (resp.status === 204) {
      return undefined as T;
    }
    const text = await resp.text();
    const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
    if (!resp.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${resp.status}`);
    }
    return data;
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

  getScripts(): Promise<ScriptTemplate[]> {
    return this.request('/api/scripts');
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

  stopWorkflow(id: number): Promise<{ workflowId: number; stoppedCount: number }> {
    return this.request(`/api/workflows/${id}/stop`, { method: 'POST' });
  }

  stopExecution(executionId: number): Promise<{ executionId: number; stopped: boolean }> {
    return this.request(`/api/executions/${executionId}/stop`, { method: 'POST' });
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
    return this.request(`/api/fs/${encodeURIComponent(name)}`, { method: 'DELETE' });
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
}
