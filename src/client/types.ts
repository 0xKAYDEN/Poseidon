export type NodeType =
  | 'http_request'
  | 'mysql_query'
  | 'db_insert'
  | 'code'
  | 'transform'
  | 'if'
  | 'wait'
  | 'ai'
  | 'mail';

export type EdgeCondition = 'always' | 'on_success' | 'on_error' | 'expression';
export type TriggerMode = 'manual' | 'schedule' | 'webhook';

export interface NodeModel {
  id: number;
  workflow_id: number;
  client_id: string;
  type: NodeType | string;
  name: string;
  script: string;
  position_x: number;
  position_y: number;
}

export interface EdgeModel {
  id: number;
  workflow_id: number;
  source_node_id: number;
  target_node_id: number;
  condition_type: EdgeCondition;
  condition_expression?: string | null;
}

export interface ExecutionModel {
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

export interface ExecutionStepModel {
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

export interface WorkflowModel {
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
  nodes: NodeModel[];
  edges: EdgeModel[];
  latest_execution?: ExecutionModel | null;
}

export interface ScriptTemplate {
  id: number;
  name: string;
  content: string;
  version: number;
  created_at: string;
}

export interface TableSummary {
  name: string;
  kind: 'system' | 'custom';
  columns: string[];
  rowCount: number;
}

export interface AuditLogItem {
  id: number;
  event_type: string;
  actor: string;
  details: string;
  created_at: string;
}

export interface SandboxFileItem {
  name: string;
  content: string;
}

export interface CanvasNodeDraft {
  clientId: string;
  serverId?: number;
  type: NodeType | string;
  name: string;
  x: number;
  y: number;
  script: string;
}

export interface CanvasEdgeDraft {
  id: string;
  sourceClientId: string;
  targetClientId: string;
  condition: EdgeCondition;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'step' | 'error' | 'success';
  message: string;
}

export const NODE_PALETTE: Array<{ type: NodeType; label: string; category: string }> = [
  { type: 'http_request', label: 'HTTP Request', category: 'Network' },
  { type: 'mysql_query', label: 'Database Query', category: 'Database' },
  { type: 'db_insert', label: 'Database Insert', category: 'Database' },
  { type: 'code', label: 'Lua Script', category: 'Logic' },
  { type: 'transform', label: 'JSON Transform', category: 'Logic' },
  { type: 'if', label: 'Conditional Branch', category: 'Flow' },
  { type: 'wait', label: 'Wait / Delay', category: 'Flow' },
  { type: 'ai', label: 'AI Chat', category: 'Intelligence' },
  { type: 'mail', label: 'Send Mail', category: 'Notify' }
];

export function getDefaultScriptForType(type: string): string {
  switch (type) {
    case 'http_request':
      return `return {
  run = function(context)
    local url = (context.inputs and context.inputs.url) or "https://jsonplaceholder.typicode.com/todos/1"
    local r = http.get(url)
    flow.log("HTTP " .. tostring(r.status_code) .. " from " .. url)
    return { status_code = r.status_code, body = r.body }
  end
}`;
    case 'mysql_query':
      return `return {
  run = function(context)
    local sql = (context.inputs and context.inputs.sql) or "SELECT id, sku, title, stock FROM items ORDER BY id ASC"
    local rows = db.query(sql)
    flow.log("Query returned " .. tostring(#rows) .. " rows")
    return { row_count = #rows, rows = rows }
  end
}`;
    case 'db_insert':
      return `return {
  run = function(context)
    local title = (context.inputs and context.inputs.title) or ("Task created at " .. flow.now())
    local count = db.insert("tasks", {
      title = title,
      assignee = "poseidon",
      priority = "medium",
      completed = false
    })
    flow.log("Inserted " .. tostring(count) .. " row into tasks")
    return { inserted = count, title = title }
  end
}`;
    case 'transform':
      return `return {
  run = function(context)
    local prev = (context.inputs and context.inputs.prev) or {}
    local data = prev.body and json.decode(prev.body) or prev
    flow.log("Transformed payload at " .. flow.now())
    return { transformed = data, uuid = crypto.uuid() }
  end
}`;
    case 'code':
      return `return {
  run = function(context)
    flow.log("Running node: " .. tostring(context.node.name))
    return { result = "ok", timestamp = flow.now(), inputs = context.inputs }
  end
}`;
    case 'if':
      return `return {
  run = function(context)
    local ok = (context.inputs and context.inputs.ok)
    if ok == nil then ok = true end
    if not ok then error("Condition evaluated to false") end
    return { branch = "success", ok = ok }
  end
}`;
    case 'wait':
      return `return {
  run = function(context)
    local ms = (context.inputs and context.inputs.ms) or 1000
    flow.log("Sleeping " .. tostring(ms) .. "ms...")
    flow.sleep(ms)
    return { waited = true, ms = ms }
  end
}`;
    case 'ai':
      return `return {
  run = function(context)
    local prev = (context.inputs and context.inputs.prev) or {}
    local text = (context.inputs and context.inputs.text) or prev.body or "Summarize Poseidon Lua workflows."
    local r = ai.chat({
      model = "gpt-4o-mini",
      messages = {
        { role = "user", content = tostring(text) }
      }
    })
    flow.log("AI replied with " .. tostring(#(r.content or "")) .. " chars")
    return { reply = r.content, model = r.model }
  end
}`;
    case 'mail':
      return `return {
  run = function(context)
    local prev = (context.inputs and context.inputs.prev) or {}
    mail.send({
      to = (context.inputs and context.inputs.to) or "ops@poseidon.local",
      subject = "Poseidon Notification",
      body = tostring(prev.reply or prev.summary or (context.inputs and context.inputs.message) or "Done")
    })
    return { sent = true }
  end
}`;
    default:
      return `return {
  run = function(context)
    return { ok = true }
  end
}`;
  }
}
