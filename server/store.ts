import { CredentialVault } from './crypto.js';

export type EdgeConditionType = 'always' | 'on_success' | 'on_error' | 'expression';
export type TriggerMode = 'manual' | 'schedule' | 'webhook';

export interface WorkflowNode {
  id: number;
  workflow_id: number;
  client_id: string;
  type: string;
  name: string;
  config_json: string | null;
  lua_script_id: number | null;
  script: string;
  position_x: number;
  position_y: number;
}

export interface WorkflowEdge {
  id: number;
  workflow_id: number;
  source_node_id: number;
  target_node_id: number;
  condition_type: EdgeConditionType;
  condition_expression: string | null;
}

export interface Workflow {
  id: number;
  name: string;
  description: string | null;
  mode: 'blueprint' | 'code';
  trigger_type: TriggerMode;
  schedule_seconds: number | null;
  definition_json: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScriptRecord {
  id: number;
  name: string;
  content: string;
  version: number;
  created_at: string;
}

export interface Execution {
  id: number;
  workflow_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  trigger_type: string;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface ExecutionStep {
  id: number;
  execution_id: number;
  node_id: number;
  node_name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface CredentialRecord {
  id: number;
  name: string;
  type: string;
  encrypted_json: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: number;
  event_type: string;
  actor: string;
  details: string;
  created_at: string;
}

export interface CustomTableMeta {
  name: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  created_at: string;
}

export interface TableSummary {
  name: string;
  kind: 'system' | 'custom';
  columns: string[];
  rowCount: number;
}

export interface WorkflowSaveNodeInput {
  id?: number | string;
  client_id?: string;
  type: string;
  name: string;
  script: string;
  config_json?: string | null;
  x?: number;
  y?: number;
  position_x?: number;
  position_y?: number;
}

export interface WorkflowSaveEdgeInput {
  source: number | string;
  target: number | string;
  condition?: EdgeConditionType;
  condition_type?: EdgeConditionType;
  condition_expression?: string | null;
}

export class PoseidonStore {
  private workflows = new Map<number, Workflow>();
  private nodes = new Map<number, WorkflowNode>();
  private edges = new Map<number, WorkflowEdge>();
  private scripts = new Map<number, ScriptRecord>();
  private executions = new Map<number, Execution>();
  private steps = new Map<number, ExecutionStep>();
  private credentials = new Map<number, CredentialRecord>();
  private auditLogs: AuditLogRecord[] = [];
  private virtualFs = new Map<string, string>();
  private customTables = new Map<string, CustomTableMeta>();

  private nextWorkflowId = 1;
  private nextNodeId = 1;
  private nextEdgeId = 1;
  private nextScriptId = 1;
  private nextExecutionId = 1;
  private nextStepId = 1;
  private nextCredentialId = 1;
  private nextAuditId = 1;

  constructor(private readonly vault: CredentialVault) {
    this.seedDefaults();
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();

    // Seed custom data tables for database exploration & Lua db.* usage
    this.customTables.set('items', {
      name: 'items',
      columns: ['id', 'sku', 'title', 'category', 'stock', 'status', 'updated_at'],
      created_at: now,
      rows: [
        { id: 1, sku: 'PSD-101', title: 'Webhook Relay Worker', category: 'Automation', stock: 24, status: 'active', updated_at: now },
        { id: 2, sku: 'PSD-102', title: 'X25519 Key Exchange Module', category: 'Security', stock: 12, status: 'active', updated_at: now },
        { id: 3, sku: 'PSD-103', title: 'Lua Sandbox Runner', category: 'Runtime', stock: 48, status: 'active', updated_at: now },
        { id: 4, sku: 'PSD-104', title: 'Legacy Poller Adapter', category: 'Integration', stock: 3, status: 'deprecated', updated_at: now }
      ]
    });

    this.customTables.set('tasks', {
      name: 'tasks',
      columns: ['id', 'title', 'assignee', 'priority', 'completed', 'created_at'],
      created_at: now,
      rows: [
        { id: 1, title: 'Sync external REST catalog', assignee: 'system', priority: 'high', completed: false, created_at: now },
        { id: 2, title: 'Verify AES-256-GCM vault rotation', assignee: 'admin', priority: 'medium', completed: true, created_at: now },
        { id: 3, title: 'Audit scheduled workflow runs', assignee: 'ops', priority: 'low', completed: false, created_at: now }
      ]
    });

    // Seed reusable Lua scripts
    this.createScript(
      'http_get.lua',
      `-- Example Poseidon node script: fetch JSON over HTTP and decode it.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local url = inputs.url or "https://jsonplaceholder.typicode.com/todos/1"

    local response = http.get(url)
    if response.status_code ~= 200 then
      error("HTTP request failed with status " .. tostring(response.status_code))
    end

    local parsed = json.decode(response.body)
    flow.log("GET " .. url .. " -> HTTP " .. tostring(response.status_code))

    return {
      status_code = response.status_code,
      data = parsed,
      body = response.body
    }
  end
}`
    );

    this.createScript(
      'db_query.lua',
      `-- Example Poseidon node script: query items table and log summary.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local sql = inputs.sql or "SELECT id, sku, title, stock, status FROM items ORDER BY id ASC"
    local rows = db.query(sql)

    flow.log("DB query returned " .. tostring(#rows) .. " rows")

    return {
      row_count = #rows,
      rows = rows
    }
  end
}`
    );

    this.createScript(
      'db_insert.lua',
      `-- Insert a record into a database table using db.insert or db.execute.
return {
  run = function(context)
    local count = db.insert("tasks", {
      title = "Generated by Lua workflow at " .. flow.now(),
      assignee = "poseidon",
      priority = "medium",
      completed = false
    })
    flow.log("Inserted " .. tostring(count) .. " row(s) into tasks")
    return { inserted = count }
  end
}`
    );

    this.createScript(
      'ai_summary.lua',
      `-- Example Poseidon node script: summarize upstream text using AI Chat.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local prev = inputs.prev or {}
    local text = inputs.text or prev.body or "Poseidon executes Lua workflows securely."

    local reply = ai.chat({
      model = "gpt-4o-mini",
      messages = {
        { role = "system", content = "You are a helpful assistant that summarizes text concisely." },
        { role = "user", content = "Summarize the following:\\n\\n" .. tostring(text) }
      }
    })

    flow.log("AI summary generated (" .. tostring(#(reply.content or "")) .. " chars)")

    return {
      summary = reply.content or "",
      model = reply.model or "stub"
    }
  end
}`
    );

    this.createScript(
      '1000.lua',
      `local ScriptID = 1000
print("hello world from Script " .. tostring(ScriptID) .. "!")
return { script_id = ScriptID, ok = true }`
    );

    // Seed Workflow 1: Blueprint
    this.createWorkflow({
      name: 'API Fetch & AI Summary',
      description: 'Fetches JSON over HTTP, summarizes via AI, and logs a notification report.',
      mode: 'blueprint',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'n1',
          type: 'http_request',
          name: 'HTTP Fetch',
          x: 70,
          y: 130,
          script: `return {
  run = function(context)
    local url = (context.inputs and context.inputs.url) or "https://jsonplaceholder.typicode.com/posts/1"
    flow.log("Fetching " .. url)
    local r = http.get(url)
    flow.log("Received HTTP " .. tostring(r.status_code) .. " (" .. #r.body .. " bytes)")
    return { status_code = r.status_code, body = r.body }
  end
}`
        },
        {
          client_id: 'n2',
          type: 'ai',
          name: 'AI Summarize',
          x: 330,
          y: 130,
          script: `return {
  run = function(context)
    local prev = context.inputs.prev or {}
    local content = prev.body or "No upstream payload"
    local r = ai.chat({
      model = "gpt-4o-mini",
      messages = {
        { role = "system", content = "Summarize the JSON payload in 1 sentence." },
        { role = "user", content = tostring(content) }
      }
    })
    flow.log("AI model=" .. tostring(r.model) .. " responded")
    return { summary = r.content, model = r.model }
  end
}`
        },
        {
          client_id: 'n3',
          type: 'mail',
          name: 'Send Report',
          x: 590,
          y: 130,
          script: `return {
  run = function(context)
    local prev = context.inputs.prev or {}
    mail.send({
      to = "ops@poseidon.local",
      subject = "Workflow Summary Ready",
      body = tostring(prev.summary or "Done")
    })
    return { sent = true, summary = prev.summary }
  end
}`
        }
      ],
      edges: [
        { source: 'n1', target: 'n2', condition: 'on_success' },
        { source: 'n2', target: 'n3', condition: 'on_success' }
      ]
    });

    // Seed Workflow 2: Database Query & Insert Pipeline
    this.createWorkflow({
      name: 'DB Inventory Audit',
      description: 'Queries the items table, verifies stock levels, and logs an audit digest.',
      mode: 'blueprint',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'db1',
          type: 'mysql_query',
          name: 'Query Items',
          x: 80,
          y: 150,
          script: `return {
  run = function(context)
    local rows = db.query("SELECT id, sku, title, stock FROM items ORDER BY id ASC")
    flow.log("Found " .. tostring(#rows) .. " items in database")
    flow.set("item_count", #rows)
    return { row_count = #rows, rows = rows }
  end
}`
        },
        {
          client_id: 'if1',
          type: 'if',
          name: 'Verify Non-Empty',
          x: 340,
          y: 150,
          script: `return {
  run = function(context)
    local count = flow.get("item_count") or 0
    local ok = count > 0
    flow.log("Branch condition ok=" .. tostring(ok))
    if not ok then error("No items returned") end
    return { branch = "success", count = count }
  end
}`
        },
        {
          client_id: 'log1',
          type: 'db_insert',
          name: 'Record Task',
          x: 600,
          y: 150,
          script: `return {
  run = function(context)
    local count = flow.get("item_count") or 0
    local digest = crypto.sha256("items:" .. tostring(count))
    db.insert("tasks", {
      title = "Inventory audit (" .. tostring(count) .. " items)",
      assignee = "poseidon",
      priority = "low",
      completed = true
    })
    flow.log("Audit task recorded with digest " .. string.sub(digest, 1, 12))
    return { digest = digest, count = count }
  end
}`
        }
      ],
      edges: [
        { source: 'db1', target: 'if1', condition: 'on_success' },
        { source: 'if1', target: 'log1', condition: 'on_success' }
      ]
    });

    // Seed Workflow 3: Standalone Lua Script
    this.createWorkflow({
      name: 'Hello World (1000.lua)',
      description: 'Standalone Lua script demonstrating sandboxed file storage and SHA-256.',
      mode: 'code',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'code1',
          type: 'code',
          name: 'Main Script',
          x: 220,
          y: 160,
          script: `return {
  run = function(context)
    flow.log("hello world from Poseidon Lua!")
    fs.write("greeting.txt", "Hello from Poseidon sandbox at " .. flow.now())
    local saved = fs.read("greeting.txt")
    return {
      ok = true,
      message = saved,
      digest = crypto.sha256(saved or "")
    }
  end
}`
        }
      ],
      edges: []
    });

    this.virtualFs.set('welcome.txt', `Poseidon sandbox initialized at ${now}`);
    this.virtualFs.set('config.json', JSON.stringify({ environment: 'development', maxRetries: 3 }, null, 2));
    this.addAudit('system_boot', 'system', 'Seeded default workflows, Lua scripts, and database tables.');
  }

  // ---------- Audit Log ----------

  addAudit(eventType: string, actor: string, details: string): AuditLogRecord {
    const rec: AuditLogRecord = {
      id: this.nextAuditId++,
      event_type: eventType,
      actor,
      details,
      created_at: new Date().toISOString()
    };
    this.auditLogs.unshift(rec);
    if (this.auditLogs.length > 300) this.auditLogs.pop();
    return rec;
  }

  getAuditLogs(): AuditLogRecord[] {
    return this.auditLogs;
  }

  // ---------- Scripts ----------

  getScripts(): ScriptRecord[] {
    return Array.from(this.scripts.values()).sort((a, b) => a.id - b.id);
  }

  createScript(name: string, content: string): ScriptRecord {
    const record: ScriptRecord = {
      id: this.nextScriptId++,
      name,
      content,
      version: 1,
      created_at: new Date().toISOString()
    };
    this.scripts.set(record.id, record);
    return record;
  }

  // ---------- Workflows ----------

  getWorkflows(): Array<Workflow & { nodes: WorkflowNode[]; edges: WorkflowEdge[]; latest_execution: Execution | null }> {
    return Array.from(this.workflows.values())
      .sort((a, b) => b.id - a.id)
      .map(wf => ({
        ...wf,
        nodes: this.getNodes(wf.id),
        edges: this.getEdges(wf.id),
        latest_execution: this.getLatestExecutionForWorkflow(wf.id)
      }));
  }

  getWorkflow(id: number): (Workflow & { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) | null {
    const wf = this.workflows.get(id);
    if (!wf) return null;
    return {
      ...wf,
      nodes: this.getNodes(id),
      edges: this.getEdges(id)
    };
  }

  createWorkflow(input: {
    name: string;
    description?: string | null;
    mode?: 'blueprint' | 'code';
    trigger_type?: TriggerMode;
    schedule_seconds?: number | null;
    is_active?: boolean;
    nodes: WorkflowSaveNodeInput[];
    edges: WorkflowSaveEdgeInput[];
  }): Workflow & { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    const now = new Date().toISOString();
    const wfId = this.nextWorkflowId++;
    const mode = input.mode ?? (input.nodes.length <= 1 ? 'code' : 'blueprint');

    const createdNodes = this.replaceWorkflowGraph(wfId, input.nodes, input.edges);
    const wf: Workflow = {
      id: wfId,
      name: input.name.trim() || `Workflow #${wfId}`,
      description: input.description ?? null,
      mode,
      trigger_type: input.trigger_type ?? 'manual',
      schedule_seconds: input.schedule_seconds ?? null,
      definition_json: JSON.stringify({ nodes: createdNodes.nodes, edges: createdNodes.edges }),
      is_active: input.is_active ?? true,
      created_at: now,
      updated_at: now
    };
    this.workflows.set(wfId, wf);
    return { ...wf, ...createdNodes };
  }

  updateWorkflow(
    id: number,
    input: {
      name?: string;
      description?: string | null;
      mode?: 'blueprint' | 'code';
      trigger_type?: TriggerMode;
      schedule_seconds?: number | null;
      is_active?: boolean;
      nodes?: WorkflowSaveNodeInput[];
      edges?: WorkflowSaveEdgeInput[];
    }
  ): (Workflow & { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) | null {
    const existing = this.workflows.get(id);
    if (!existing) return null;

    let nodes = this.getNodes(id);
    let edges = this.getEdges(id);

    if (input.nodes) {
      const replaced = this.replaceWorkflowGraph(id, input.nodes, input.edges ?? []);
      nodes = replaced.nodes;
      edges = replaced.edges;
    }

    const updated: Workflow = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() || existing.name : existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      mode: input.mode ?? existing.mode,
      trigger_type: input.trigger_type ?? existing.trigger_type,
      schedule_seconds: input.schedule_seconds !== undefined ? input.schedule_seconds : existing.schedule_seconds,
      is_active: input.is_active ?? existing.is_active,
      definition_json: JSON.stringify({ nodes, edges }),
      updated_at: new Date().toISOString()
    };
    this.workflows.set(id, updated);
    return { ...updated, nodes, edges };
  }

  cloneWorkflow(id: number): (Workflow & { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) | null {
    const existing = this.getWorkflow(id);
    if (!existing) return null;

    const idMap = new Map<number, string>();
    const nodes: WorkflowSaveNodeInput[] = existing.nodes.map(n => {
      const cid = n.client_id || `n_${n.id}`;
      idMap.set(n.id, cid);
      return {
        client_id: cid,
        type: n.type,
        name: n.name,
        script: n.script,
        config_json: n.config_json,
        x: n.position_x,
        y: n.position_y
      };
    });

    const edges: WorkflowSaveEdgeInput[] = existing.edges
      .map((e): WorkflowSaveEdgeInput | null => {
        const src = idMap.get(e.source_node_id);
        const tgt = idMap.get(e.target_node_id);
        if (!src || !tgt) return null;
        return { source: src, target: tgt, condition: e.condition_type };
      })
      .filter((x): x is WorkflowSaveEdgeInput => x !== null);

    return this.createWorkflow({
      name: `${existing.name} (Copy)`,
      description: existing.description,
      mode: existing.mode,
      trigger_type: existing.trigger_type,
      schedule_seconds: existing.schedule_seconds,
      is_active: existing.is_active,
      nodes,
      edges
    });
  }

  deleteWorkflow(id: number): boolean {
    if (!this.workflows.has(id)) return false;
    this.workflows.delete(id);
    for (const [nid, node] of this.nodes.entries()) {
      if (node.workflow_id === id) this.nodes.delete(nid);
    }
    for (const [eid, edge] of this.edges.entries()) {
      if (edge.workflow_id === id) this.edges.delete(eid);
    }
    return true;
  }

  private replaceWorkflowGraph(
    workflowId: number,
    nodeInputs: WorkflowSaveNodeInput[],
    edgeInputs: WorkflowSaveEdgeInput[]
  ): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    for (const [nid, node] of this.nodes.entries()) {
      if (node.workflow_id === workflowId) this.nodes.delete(nid);
    }
    for (const [eid, edge] of this.edges.entries()) {
      if (edge.workflow_id === workflowId) this.edges.delete(eid);
    }

    const refToNodeId = new Map<string, number>();
    const createdNodes: WorkflowNode[] = [];

    for (const n of nodeInputs) {
      const nodeId = this.nextNodeId++;
      const clientId = String(n.client_id ?? n.id ?? nodeId);
      const node: WorkflowNode = {
        id: nodeId,
        workflow_id: workflowId,
        client_id: clientId,
        type: n.type || 'code',
        name: n.name || 'Node',
        config_json: n.config_json ?? null,
        lua_script_id: null,
        script: n.script ?? '',
        position_x: Math.round(n.position_x ?? n.x ?? 100),
        position_y: Math.round(n.position_y ?? n.y ?? 100)
      };
      this.nodes.set(nodeId, node);
      createdNodes.push(node);
      refToNodeId.set(clientId, nodeId);
      if (n.id !== undefined) refToNodeId.set(String(n.id), nodeId);
    }

    const createdEdges: WorkflowEdge[] = [];
    for (const e of edgeInputs) {
      const sourceId = refToNodeId.get(String(e.source));
      const targetId = refToNodeId.get(String(e.target));
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const edgeId = this.nextEdgeId++;
      const edge: WorkflowEdge = {
        id: edgeId,
        workflow_id: workflowId,
        source_node_id: sourceId,
        target_node_id: targetId,
        condition_type: e.condition_type ?? e.condition ?? 'always',
        condition_expression: e.condition_expression ?? null
      };
      this.edges.set(edgeId, edge);
      createdEdges.push(edge);
    }

    return { nodes: createdNodes, edges: createdEdges };
  }

  getNodes(workflowId: number): WorkflowNode[] {
    return Array.from(this.nodes.values())
      .filter(n => n.workflow_id === workflowId)
      .sort((a, b) => a.id - b.id);
  }

  getEdges(workflowId: number): WorkflowEdge[] {
    return Array.from(this.edges.values())
      .filter(e => e.workflow_id === workflowId)
      .sort((a, b) => a.id - b.id);
  }

  // ---------- Executions & Steps ----------

  createExecution(workflowId: number, triggerType: string, inputJson: string | null): Execution {
    const exec: Execution = {
      id: this.nextExecutionId++,
      workflow_id: workflowId,
      status: 'queued',
      trigger_type: triggerType,
      input_json: inputJson,
      output_json: null,
      error: null,
      started_at: new Date().toISOString(),
      finished_at: null
    };
    this.executions.set(exec.id, exec);
    return exec;
  }

  getExecution(id: number): Execution | undefined {
    return this.executions.get(id);
  }

  getExecutions(workflowId?: number): Execution[] {
    return Array.from(this.executions.values())
      .filter(e => workflowId === undefined || e.workflow_id === workflowId)
      .sort((a, b) => b.id - a.id);
  }

  getLatestExecutionForWorkflow(workflowId: number): Execution | null {
    const list = this.getExecutions(workflowId);
    return list.length > 0 ? list[0] : null;
  }

  markExecutionRunning(executionId: number): void {
    const exec = this.executions.get(executionId);
    if (!exec) return;
    exec.status = 'running';
    exec.started_at = new Date().toISOString();
  }

  updateExecutionStatus(
    executionId: number,
    status: Execution['status'],
    outputJson: string | null = null,
    error: string | null = null
  ): void {
    const exec = this.executions.get(executionId);
    if (!exec) return;
    exec.status = status;
    if (outputJson !== null) exec.output_json = outputJson;
    if (error !== null) exec.error = error;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      exec.finished_at = new Date().toISOString();
    }
  }

  createStep(executionId: number, nodeId: number, nodeName: string, inputJson: string | null): ExecutionStep {
    const step: ExecutionStep = {
      id: this.nextStepId++,
      execution_id: executionId,
      node_id: nodeId,
      node_name: nodeName,
      status: 'running',
      input_json: inputJson,
      output_json: null,
      error: null,
      duration_ms: null,
      started_at: new Date().toISOString(),
      finished_at: null
    };
    this.steps.set(step.id, step);
    return step;
  }

  completeStep(
    stepId: number,
    status: ExecutionStep['status'],
    outputJson: string | null = null,
    error: string | null = null,
    durationMs: number | null = null
  ): void {
    const step = this.steps.get(stepId);
    if (!step) return;
    step.status = status;
    step.output_json = outputJson;
    step.error = error;
    step.duration_ms = durationMs;
    step.finished_at = new Date().toISOString();
  }

  getSteps(executionId: number): ExecutionStep[] {
    return Array.from(this.steps.values())
      .filter(s => s.execution_id === executionId)
      .sort((a, b) => a.id - b.id);
  }

  // ---------- Credentials ----------

  listCredentials(): Array<{ id: number; name: string; type: string; created_at: string }> {
    return Array.from(this.credentials.values()).map(({ id, name, type, created_at }) => ({
      id,
      name,
      type,
      created_at
    }));
  }

  saveCredential(name: string, type: string, secretData: Record<string, unknown>): CredentialRecord {
    const encrypted = this.vault.encrypt(secretData);
    for (const existing of this.credentials.values()) {
      if (existing.name === name) {
        existing.type = type;
        existing.encrypted_json = encrypted;
        return existing;
      }
    }
    const rec: CredentialRecord = {
      id: this.nextCredentialId++,
      name,
      type,
      encrypted_json: encrypted,
      created_at: new Date().toISOString()
    };
    this.credentials.set(rec.id, rec);
    return rec;
  }

  deleteCredential(id: number): boolean {
    return this.credentials.delete(id);
  }

  getDecryptedSecretsMap(): Record<string, Record<string, unknown>> {
    const secrets: Record<string, Record<string, unknown>> = {};
    for (const cred of this.credentials.values()) {
      try {
        secrets[cred.name] = this.vault.decrypt(cred.encrypted_json);
      } catch {
        // skip
      }
    }
    return secrets;
  }

  // ---------- Virtual Sandboxed FS ----------

  fsRead(path: string): string | null {
    const normalized = path.replace(/^\/+/, '');
    if (normalized.includes('..')) throw new Error(`Path escapes sandbox: ${path}`);
    return this.virtualFs.get(normalized) ?? null;
  }

  fsWrite(path: string, content: string): void {
    const normalized = path.replace(/^\/+/, '');
    if (normalized.includes('..')) throw new Error(`Path escapes sandbox: ${path}`);
    this.virtualFs.set(normalized, content ?? '');
  }

  fsDelete(path: string): boolean {
    const normalized = path.replace(/^\/+/, '');
    return this.virtualFs.delete(normalized);
  }

  fsExists(path: string): boolean {
    const normalized = path.replace(/^\/+/, '');
    if (normalized.includes('..')) return false;
    return this.virtualFs.has(normalized);
  }

  fsList(): string[] {
    return Array.from(this.virtualFs.keys()).sort();
  }

  // ---------- Database Management & SQL Engine ----------

  listTables(): TableSummary[] {
    const system: TableSummary[] = [
      {
        name: 'workflows',
        kind: 'system',
        columns: ['id', 'name', 'mode', 'trigger_type', 'is_active', 'updated_at'],
        rowCount: this.workflows.size
      },
      {
        name: 'workflow_nodes',
        kind: 'system',
        columns: ['id', 'workflow_id', 'type', 'name', 'position_x', 'position_y'],
        rowCount: this.nodes.size
      },
      {
        name: 'scripts',
        kind: 'system',
        columns: ['id', 'name', 'version', 'created_at'],
        rowCount: this.scripts.size
      },
      {
        name: 'executions',
        kind: 'system',
        columns: ['id', 'workflow_id', 'status', 'trigger_type', 'started_at', 'finished_at'],
        rowCount: this.executions.size
      },
      {
        name: 'execution_steps',
        kind: 'system',
        columns: ['id', 'execution_id', 'node_name', 'status', 'duration_ms'],
        rowCount: this.steps.size
      },
      {
        name: 'credentials',
        kind: 'system',
        columns: ['id', 'name', 'type', 'created_at'],
        rowCount: this.credentials.size
      },
      {
        name: 'audit_log',
        kind: 'system',
        columns: ['id', 'event_type', 'actor', 'details', 'created_at'],
        rowCount: this.auditLogs.length
      }
    ];

    const custom: TableSummary[] = Array.from(this.customTables.values()).map(t => ({
      name: t.name,
      kind: 'custom',
      columns: t.columns,
      rowCount: t.rows.length
    }));

    return [...custom, ...system];
  }

  createCustomTable(name: string, columns: string[]): TableSummary {
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanName) throw new Error('Invalid table name');
    if (this.customTables.has(cleanName) || this.isSystemTable(cleanName)) {
      throw new Error(`Table "${cleanName}" already exists`);
    }
    const cleanCols = Array.from(
      new Set(['id', ...columns.map(c => c.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')).filter(Boolean)])
    );
    const meta: CustomTableMeta = {
      name: cleanName,
      columns: cleanCols,
      rows: [],
      created_at: new Date().toISOString()
    };
    this.customTables.set(cleanName, meta);
    return { name: meta.name, kind: 'custom', columns: meta.columns, rowCount: 0 };
  }

  dropCustomTable(name: string): boolean {
    return this.customTables.delete(name.toLowerCase());
  }

  insertCustomRow(tableName: string, rowInput: Record<string, unknown>): Record<string, unknown> {
    const table = this.customTables.get(tableName.toLowerCase());
    if (!table) throw new Error(`Custom table "${tableName}" not found`);
    const nextId = table.rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
    const row: Record<string, unknown> = { id: nextId };
    for (const col of table.columns) {
      if (col === 'id' && rowInput.id === undefined) continue;
      if (rowInput[col] !== undefined) {
        row[col] = rowInput[col];
      } else if (col === 'created_at' || col === 'updated_at') {
        row[col] = new Date().toISOString();
      } else {
        row[col] = null;
      }
    }
    for (const [k, v] of Object.entries(rowInput)) {
      if (!table.columns.includes(k)) {
        table.columns.push(k);
      }
      row[k] = v;
    }
    table.rows.push(row);
    return row;
  }

  deleteCustomRowByIndex(tableName: string, rowId: number): boolean {
    const table = this.customTables.get(tableName.toLowerCase());
    if (!table) return false;
    const idx = table.rows.findIndex(r => Number(r.id) === rowId);
    if (idx === -1) return false;
    table.rows.splice(idx, 1);
    return true;
  }

  getTableData(tableName: string): { meta: TableSummary; rows: Array<Record<string, unknown>> } | null {
    const summary = this.listTables().find(t => t.name === tableName.toLowerCase());
    if (!summary) return null;
    const rows = this.getRawTableRows(tableName.toLowerCase());
    return { meta: summary, rows };
  }

  private isSystemTable(name: string): boolean {
    return ['workflows', 'workflow_nodes', 'workflow_edges', 'scripts', 'executions', 'execution_steps', 'credentials', 'audit_log'].includes(
      name.toLowerCase()
    );
  }

  private getRawTableRows(table: string): Array<Record<string, unknown>> {
    switch (table) {
      case 'workflows':
        return Array.from(this.workflows.values()).map(w => ({
          id: w.id,
          name: w.name,
          mode: w.mode,
          trigger_type: w.trigger_type,
          is_active: w.is_active,
          updated_at: w.updated_at
        }));
      case 'workflow_nodes':
        return Array.from(this.nodes.values()).map(n => ({
          id: n.id,
          workflow_id: n.workflow_id,
          type: n.type,
          name: n.name,
          position_x: n.position_x,
          position_y: n.position_y
        }));
      case 'workflow_edges':
        return Array.from(this.edges.values()).map(e => ({ ...e }));
      case 'scripts':
        return Array.from(this.scripts.values()).map(s => ({
          id: s.id,
          name: s.name,
          version: s.version,
          created_at: s.created_at
        }));
      case 'executions':
        return Array.from(this.executions.values()).map(e => ({
          id: e.id,
          workflow_id: e.workflow_id,
          status: e.status,
          trigger_type: e.trigger_type,
          started_at: e.started_at,
          finished_at: e.finished_at
        }));
      case 'execution_steps':
        return Array.from(this.steps.values()).map(s => ({
          id: s.id,
          execution_id: s.execution_id,
          node_name: s.node_name,
          status: s.status,
          duration_ms: s.duration_ms
        }));
      case 'credentials':
        return this.listCredentials().map(c => ({ ...c }));
      case 'audit_log':
        return this.auditLogs.map(a => ({ ...a }));
      default:
        return (this.customTables.get(table)?.rows ?? []).map(r => ({ ...r }));
    }
  }

  runSqlStatement(sql: string, params: unknown[] = []): {
    rows: Array<Record<string, unknown>>;
    columns: string[];
    affectedRows: number;
    message?: string;
  } {
    const trimmed = sql.trim().replace(/;+$/, '');
    const lower = trimmed.toLowerCase();

    if (/^show\s+tables$/i.test(trimmed)) {
      const tables = this.listTables().map(t => ({
        table_name: t.name,
        kind: t.kind,
        row_count: t.rowCount
      }));
      return { rows: tables, columns: ['table_name', 'kind', 'row_count'], affectedRows: 0 };
    }

    if (/^create\s+table/i.test(trimmed)) {
      const m = trimmed.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)\s*\(([^)]+)\)/i);
      if (!m) throw new Error('Syntax error in CREATE TABLE. Example: CREATE TABLE logs (id INT, message TEXT)');
      const tableName = m[1];
      const cols = m[2].split(',').map(part => part.trim().split(/\s+/)[0]);
      const created = this.createCustomTable(tableName, cols);
      return {
        rows: [],
        columns: created.columns,
        affectedRows: 0,
        message: `Table "${created.name}" created with columns: ${created.columns.join(', ')}`
      };
    }

    if (/^select\b/i.test(trimmed)) {
      const rows = this.querySql(trimmed, params);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { rows, columns, affectedRows: 0 };
    }

    const affected = this.executeSql(trimmed, params);
    return {
      rows: [],
      columns: [],
      affectedRows: affected,
      message: `${affected} row(s) affected`
    };
  }

  querySql(sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
    const trimmed = sql.trim().replace(/;+$/, '');
    const lower = trimmed.toLowerCase();

    if (/^select\s+1(\s+as\s+(\w+))?$/i.test(trimmed)) {
      const m = trimmed.match(/^select\s+1\s+as\s+(\w+)/i);
      return [{ [m ? m[1] : '1']: 1 }];
    }

    const selectMatch = trimmed.match(/^select\s+(.+?)\s+from\s+([a-z0-9_]+)/i);
    if (!selectMatch) return [];

    const selectClause = selectMatch[1].trim();
    const table = selectMatch[2].toLowerCase();
    let rows = this.getRawTableRows(table);

    // WHERE clause
    const whereMatch = trimmed.match(/\bwhere\s+([a-z0-9_]+)\s*(=|!=|>|<|>=|<=|like)\s*(\?|@\w+|'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|true|false)/i);
    if (whereMatch) {
      const col = whereMatch[1];
      const op = whereMatch[2].toLowerCase();
      let target: unknown = whereMatch[3];
      if (target === '?' || String(target).startsWith('@')) {
        target = params[0];
      } else if ((String(target).startsWith("'") && String(target).endsWith("'")) || (String(target).startsWith('"') && String(target).endsWith('"'))) {
        target = String(target).slice(1, -1);
      } else if (target === 'true' || target === 'false') {
        target = target === 'true';
      } else if (/^-?\d+(\.\d+)?$/.test(String(target))) {
        target = Number(target);
      }

      rows = rows.filter(r => {
        const val = r[col];
        if (op === '=') return String(val) === String(target);
        if (op === '!=') return String(val) !== String(target);
        if (op === '>') return Number(val) > Number(target);
        if (op === '<') return Number(val) < Number(target);
        if (op === '>=') return Number(val) >= Number(target);
        if (op === '<=') return Number(val) <= Number(target);
        if (op === 'like') {
          const pattern = String(target).replace(/%/g, '.*').toLowerCase();
          return new RegExp(`^${pattern}$`).test(String(val ?? '').toLowerCase());
        }
        return true;
      });
    }

    // ORDER BY
    const orderMatch = trimmed.match(/\border\s+by\s+([a-z0-9_]+)(?:\s+(asc|desc))?/i);
    if (orderMatch) {
      const col = orderMatch[1];
      const dir = (orderMatch[2] || 'asc').toLowerCase() === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }

    // LIMIT
    const limitMatch = lower.match(/\blimit\s+(\d+)/);
    if (limitMatch) {
      rows = rows.slice(0, Number.parseInt(limitMatch[1], 10));
    }

    // Column projection
    if (selectClause !== '*') {
      const cols = selectClause.split(',').map(c => c.trim());
      rows = rows.map(r => {
        const projected: Record<string, unknown> = {};
        for (const colExpr of cols) {
          const aliasMatch = colExpr.match(/^([a-z0-9_]+)\s+as\s+([a-z0-9_]+)$/i);
          if (aliasMatch) {
            projected[aliasMatch[2]] = r[aliasMatch[1]] ?? null;
          } else {
            projected[colExpr] = r[colExpr] ?? null;
          }
        }
        return projected;
      });
    }

    return rows;
  }

  executeSql(sql: string, params: unknown[] = []): number {
    const trimmed = sql.trim().replace(/;+$/, '');

    const insertMatch = trimmed.match(/^insert\s+into\s+([a-z0-9_]+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const tableName = insertMatch[1].toLowerCase();
      if (!this.customTables.has(tableName)) {
        if (this.isSystemTable(tableName)) {
          throw new Error(`System table "${tableName}" is read-only from SQL console`);
        }
        this.createCustomTable(tableName, insertMatch[2].split(',').map(s => s.trim()));
      }
      const cols = insertMatch[2].split(',').map(s => s.trim());
      const valsRaw = insertMatch[3].split(',').map(s => s.trim());
      let paramIdx = 0;
      const rowInput: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        const raw = valsRaw[i] ?? '';
        if (raw === '?' || raw.startsWith('@')) {
          rowInput[col] = params[paramIdx++];
        } else if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
          rowInput[col] = raw.slice(1, -1);
        } else if (raw === 'true' || raw === 'false') {
          rowInput[col] = raw === 'true';
        } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
          rowInput[col] = Number(raw);
        } else {
          rowInput[col] = raw;
        }
      });
      this.insertCustomRow(tableName, rowInput);
      return 1;
    }

    const updateMatch = trimmed.match(/^update\s+([a-z0-9_]+)\s+set\s+(.+?)(?:\s+where\s+([a-z0-9_]+)\s*=\s*(.+))?$/i);
    if (updateMatch) {
      const table = this.customTables.get(updateMatch[1].toLowerCase());
      if (!table) throw new Error(`Custom table "${updateMatch[1]}" not found`);
      const assignments = updateMatch[2].split(',').map(s => s.trim());
      const whereCol = updateMatch[3];
      const whereValRaw = updateMatch[4]?.trim();
      const whereVal = whereValRaw?.replace(/^['"]|['"]$/g, '');

      let updated = 0;
      for (const row of table.rows) {
        if (!whereCol || String(row[whereCol]) === String(whereVal)) {
          for (const assign of assignments) {
            const [k, vRaw] = assign.split('=').map(s => s.trim());
            if (!k) continue;
            let val: unknown = vRaw;
            if ((vRaw.startsWith("'") && vRaw.endsWith("'")) || (vRaw.startsWith('"') && vRaw.endsWith('"'))) {
              val = vRaw.slice(1, -1);
            } else if (vRaw === 'true' || vRaw === 'false') {
              val = vRaw === 'true';
            } else if (/^-?\d+(\.\d+)?$/.test(vRaw)) {
              val = Number(vRaw);
            }
            row[k] = val;
          }
          updated++;
        }
      }
      return updated;
    }

    const deleteMatch = trimmed.match(/^delete\s+from\s+([a-z0-9_]+)(?:\s+where\s+([a-z0-9_]+)\s*=\s*(.+))?$/i);
    if (deleteMatch) {
      const table = this.customTables.get(deleteMatch[1].toLowerCase());
      if (!table) throw new Error(`Custom table "${deleteMatch[1]}" not found`);
      const whereCol = deleteMatch[2];
      const whereVal = deleteMatch[3]?.trim().replace(/^['"]|['"]$/g, '');
      const before = table.rows.length;
      if (!whereCol) {
        table.rows = [];
      } else {
        table.rows = table.rows.filter(r => String(r[whereCol]) !== String(whereVal));
      }
      return before - table.rows.length;
    }

    return 0;
  }
}
