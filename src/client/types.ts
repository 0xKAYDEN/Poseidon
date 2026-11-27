export type NodeType =
  | 'http_request'
  | 'mysql_query'
  | 'db_insert'
  | 'db_update'
  | 'code'
  | 'transform'
  | 'csv_parse'
  | 'kv_store'
  | 'if'
  | 'wait'
  | 'ai'
  | 'ai_embed'
  | 'crypto_hash'
  | 'file_ops'
  | 'webhook_notify'
  | 'mail';

export type EdgeCondition = 'always' | 'on_success' | 'on_error' | 'expression';
export type TriggerMode = 'manual' | 'schedule' | 'webhook';

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
  docsHint: string;
}

export interface AiProviderModel {
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

export interface ConnectionModel {
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

export interface ConnectionTestResult {
  ok: boolean;
  category: ConnectionCategory;
  message: string;
  latencyMs: number;
  statusCode?: number;
  details?: Record<string, unknown>;
}

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
  category?: string;
  description?: string;
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
  { type: 'ai', label: 'AI Chat', category: 'Intelligence' },
  { type: 'ai_embed', label: 'AI Embeddings', category: 'Intelligence' },
  { type: 'mysql_query', label: 'Database Query', category: 'Database' },
  { type: 'db_insert', label: 'Database Insert', category: 'Database' },
  { type: 'db_update', label: 'Database Update', category: 'Database' },
  { type: 'kv_store', label: 'KV State Store', category: 'State' },
  { type: 'csv_parse', label: 'CSV Parse / Export', category: 'Data' },
  { type: 'transform', label: 'JSON & Text Transform', category: 'Logic' },
  { type: 'code', label: 'Lua Script', category: 'Logic' },
  { type: 'if', label: 'Conditional Branch', category: 'Flow' },
  { type: 'wait', label: 'Wait / Delay', category: 'Flow' },
  { type: 'crypto_hash', label: 'Crypto & Sign', category: 'Security' },
  { type: 'file_ops', label: 'Sandbox File I/O', category: 'Storage' },
  { type: 'webhook_notify', label: 'Webhook / Slack / Discord', category: 'Notify' },
  { type: 'mail', label: 'Send Mail', category: 'Notify' }
];

export interface LuaDocFunction {
  signature: string;
  description: string;
  snippet: string;
}

export interface LuaDocModule {
  module: string;
  summary: string;
  functions: LuaDocFunction[];
}

export const LUA_FUNCTION_DOCS: LuaDocModule[] = [
  {
    module: 'ai',
    summary: 'Multi-provider AI Gateway (OpenAI, Anthropic, Gemini, Groq, OpenRouter, DeepSeek, Mistral, xAI, Ollama, Azure, Cohere, Custom)',
    functions: [
      {
        signature: 'ai.chat(req)',
        description: 'Send a chat completion to the default, named, or inline custom provider.',
        snippet: 'local res = ai.chat({ provider = "openai", prompt = "Summarize this workflow." })'
      },
      {
        signature: 'ai.complete(prompt, opts?)',
        description: 'Shorthand single-prompt chat completion.',
        snippet: 'local res = ai.complete("List 3 automation ideas", { provider = "anthropic", temperature = 0.5 })'
      },
      {
        signature: 'ai.embed(input, opts?)',
        description: 'Generate vector embeddings for a string or array of strings.',
        snippet: 'local emb = ai.embed("Poseidon Lua workflows", { provider = "openai" })'
      },
      {
        signature: 'ai.providers()',
        description: 'List all configured AI providers and their capabilities.',
        snippet: 'local list = ai.providers()'
      },
      {
        signature: 'ai.models(providerId?)',
        description: 'Get configured model names for a provider or all providers.',
        snippet: 'local models = ai.models("openai")'
      }
    ]
  },
  {
    module: 'http',
    summary: 'Outbound HTTP/HTTPS client with automatic JSON encoding/decoding',
    functions: [
      {
        signature: 'http.request(opts)',
        description: 'Flexible HTTP call supporting method, url, query, headers, json, body, timeout_ms.',
        snippet: 'local r = http.request({ method = "POST", url = "https://httpbin.org/post", json = { ok = true } })'
      },
      {
        signature: 'http.get(url, headers?)',
        description: 'Perform an HTTP GET request.',
        snippet: 'local r = http.get("https://jsonplaceholder.typicode.com/todos/1")'
      },
      {
        signature: 'http.post(url, body, headers?)',
        description: 'HTTP POST (accepts string or Lua table as body).',
        snippet: 'local r = http.post("https://httpbin.org/post", { event = "run" })'
      },
      {
        signature: 'http.put / http.patch / http.delete',
        description: 'RESTful PUT, PATCH, and DELETE helpers.',
        snippet: 'local r = http.patch("https://httpbin.org/patch", { status = "active" })'
      }
    ]
  },
  {
    module: 'db',
    summary: 'Integrated database CRUD & SQL console API',
    functions: [
      {
        signature: 'db.query(sql, ...)',
        description: 'Run a SELECT query and return rows as a Lua array.',
        snippet: 'local rows = db.query("SELECT id, sku, title FROM items ORDER BY id ASC")'
      },
      {
        signature: 'db.find(table, whereObj?)',
        description: 'Filter rows from a table using a key/value match table.',
        snippet: 'local active = db.find("items", { status = "active" })'
      },
      {
        signature: 'db.insert(table, row)',
        description: 'Insert a row into a custom table.',
        snippet: 'db.insert("tasks", { title = "Sync job", assignee = "poseidon", priority = "high", completed = false })'
      },
      {
        signature: 'db.update(table, idOrWhere, patch)',
        description: 'Update matching rows in a custom table.',
        snippet: 'db.update("tasks", { id = 1 }, { completed = true })'
      },
      {
        signature: 'db.delete(table, idOrWhere)',
        description: 'Delete matching rows from a custom table.',
        snippet: 'db.delete("tasks", { completed = true })'
      },
      {
        signature: 'db.count(table) / db.tables()',
        description: 'Count rows or list all available tables.',
        snippet: 'local total = db.count("items")'
      }
    ]
  },
  {
    module: 'kv',
    summary: 'Persistent cross-run key-value store with optional TTL (seconds)',
    functions: [
      {
        signature: 'kv.get(key)',
        description: 'Read a persisted value by key (returns nil if missing/expired).',
        snippet: 'local val = kv.get("cursor:last_id")'
      },
      {
        signature: 'kv.set(key, value, ttlSeconds?)',
        description: 'Persist any JSON-compatible value across workflow runs.',
        snippet: 'kv.set("cursor:last_id", 42, 3600)'
      },
      {
        signature: 'kv.delete(key) / kv.list(prefix?)',
        description: 'Remove or list persisted KV entries.',
        snippet: 'local entries = kv.list("cursor:")'
      }
    ]
  },
  {
    module: 'csv',
    summary: 'RFC-4180 CSV parser and serializer',
    functions: [
      {
        signature: 'csv.parse(text, opts?)',
        description: 'Parse CSV string into Lua tables ({ header = true, delimiter = "," }).',
        snippet: 'local rows = csv.parse("sku,qty\\nA1,10", { header = true })'
      },
      {
        signature: 'csv.stringify(rows, opts?)',
        description: 'Convert array of tables back to CSV text.',
        snippet: 'local out = csv.stringify(rows)'
      }
    ]
  },
  {
    module: 'text & encoding',
    summary: 'Templates, regex, string helpers, Base64, URL, and Hex codecs',
    functions: [
      {
        signature: 'text.template(tpl, vars)',
        description: 'Interpolate {{key}} and {{nested.key}} placeholders.',
        snippet: 'local msg = text.template("Hello {{name}}", { name = "Poseidon" })'
      },
      {
        signature: 'text.regex_match / text.regex_replace',
        description: 'JavaScript-compatible regular expression matching and replacement.',
        snippet: 'local m = text.regex_match("Order #1234", "#(\\\\d+)")'
      },
      {
        signature: 'text.trim / split / replace / contains / slugify',
        description: 'Common string formatting utilities.',
        snippet: 'local slug = text.slugify("Hello Poseidon World!")'
      },
      {
        signature: 'encoding.base64_encode / base64_decode / url_encode / hex_encode',
        description: 'Encode or decode UTF-8 strings safely.',
        snippet: 'local b64 = encoding.base64_encode("poseidon")'
      }
    ]
  },
  {
    module: 'crypto',
    summary: 'Hashing, HMAC signing, UUIDs, AES-256-GCM, and constant-time comparison',
    functions: [
      {
        signature: 'crypto.sha256 / sha512 / md5',
        description: 'Digest helpers.',
        snippet: 'local hash = crypto.sha256("payload")'
      },
      {
        signature: 'crypto.hmac_sha256 / hmac_sha512(data, key)',
        description: 'Hex-encoded HMAC authentication signatures.',
        snippet: 'local sig = crypto.hmac_sha256(body, secret)'
      },
      {
        signature: 'crypto.aes_encrypt / aes_decrypt(b64, keyB64)',
        description: 'Authenticated AES-256-GCM encryption on base64 payloads.',
        snippet: 'local key = crypto.random_bytes(32)'
      },
      {
        signature: 'crypto.uuid / random_int / constant_time_equals',
        description: 'Secure random generators and timing-safe equality.',
        snippet: 'local id = crypto.uuid()'
      }
    ]
  },
  {
    module: 'fs & json',
    summary: 'Sandboxed virtual filesystem and JSON codecs',
    functions: [
      {
        signature: 'fs.read_json / fs.write_json / fs.append / fs.stat / fs.delete',
        description: 'Read, write, append, and inspect sandboxed files.',
        snippet: 'fs.write_json("output/result.json", { ok = true, at = flow.now() })'
      },
      {
        signature: 'json.encode / json.decode',
        description: 'Serialize and parse JSON strings.',
        snippet: 'local obj = json.decode(r.body)'
      }
    ]
  },
  {
    module: 'flow, notify & mail',
    summary: 'Execution state, real-time WS events, Slack/Discord/Webhook alerts, and mail',
    functions: [
      {
        signature: 'flow.get / flow.set / flow.emit / flow.unix_ms / flow.sleep / flow.assert',
        description: 'Manage intra-run state, emit real-time WS events, sleep, and assert invariants.',
        snippet: 'flow.emit("step_metric", { count = 5 })'
      },
      {
        signature: 'notify.webhook / notify.slack / notify.discord',
        description: 'Post structured alerts to webhooks, Slack, or Discord.',
        snippet: 'notify.slack(webhookUrl, "Poseidon workflow finished!")'
      },
      {
        signature: 'mail.send({ to, subject, body })',
        description: 'Log and dispatch notification messages.',
        snippet: 'mail.send({ to = "ops@poseidon.local", subject = "Done", body = "OK" })'
      }
    ]
  },
  {
    module: 'connections & secrets',
    summary: 'Access saved Telegram bot tokens, webhooks, API tokens, and encrypted secrets from the Connections tab',
    functions: [
      {
        signature: 'connections.get(name)',
        description: 'Load full resolved connection object (token, url, webhook_secret, headers, metadata, extra).',
        snippet: 'local conn = connections.get("telegram_bot_token")'
      },
      {
        signature: 'connections.token(name)',
        description: 'Shortcut to read the saved token or secret value of a connection.',
        snippet: 'local token = connections.token("telegram_bot_token")'
      },
      {
        signature: 'connections.url(name)',
        description: 'Shortcut to read the saved webhook URL or endpoint URL of a connection.',
        snippet: 'local url = connections.url("slack_webhook")'
      },
      {
        signature: 'connections.find(category)',
        description: 'Find the first enabled connection for a category ("telegram", "webhook", "slack", "discord", "github").',
        snippet: 'local tg = connections.find("telegram")'
      },
      {
        signature: 'connections.list(category?) / secrets.get(name)',
        description: 'List connection metadata or read any encrypted secret entry by name.',
        snippet: 'local list = connections.list()'
      }
    ]
  }
];

export function getDefaultScriptForType(type: string): string {
  switch (type) {
    case 'http_request':
      return `return {
  run = function(context)
    local url = (context.inputs and context.inputs.url) or "https://jsonplaceholder.typicode.com/todos/1"
    local r = http.get(url)
    flow.log("HTTP " .. tostring(r.status_code) .. " from " .. url)
    return { status_code = r.status_code, body = r.body, json = r.json }
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
    case 'db_update':
      return `return {
  run = function(context)
    local id = (context.inputs and context.inputs.id) or 1
    local updated = db.update("tasks", { id = id }, { completed = true })
    flow.log("Updated " .. tostring(updated) .. " row(s) in tasks")
    return { updated = updated, id = id }
  end
}`;
    case 'kv_store':
      return `return {
  run = function(context)
    local key = (context.inputs and context.inputs.key) or "workflow:counter"
    local nextVal = tonumber(kv.get(key) or 0) + 1
    kv.set(key, nextVal, 3600)
    flow.log("KV [" .. key .. "] = " .. tostring(nextVal))
    return { key = key, value = nextVal }
  end
}`;
    case 'csv_parse':
      return `return {
  run = function(context)
    local raw = (context.inputs and context.inputs.csv) or "sku,title,stock\\nPSD-101,Worker,12\\nPSD-102,Runner,8"
    local rows = csv.parse(raw, { header = true })
    flow.log("Parsed " .. tostring(#rows) .. " CSV rows")
    return { row_count = #rows, rows = rows, csv_roundtrip = csv.stringify(rows) }
  end
}`;
    case 'transform':
      return `return {
  run = function(context)
    local prev = (context.inputs and context.inputs.prev) or {}
    local data = (type(prev.body) == "string" and json.decode(prev.body)) or prev
    local summary = text.template("Processed at {{now}} ({{id}})", { now = flow.now(), id = crypto.uuid() })
    flow.log(summary)
    return { transformed = data, summary = summary }
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
    local textInput = (context.inputs and context.inputs.text) or prev.body or "Summarize Poseidon Lua workflows."
    local r = ai.chat({
      provider = (context.inputs and context.inputs.provider) or nil,
      system = "You are a concise automation assistant.",
      prompt = tostring(textInput)
    })
    flow.log("AI [" .. tostring(r.provider) .. "/" .. tostring(r.model) .. "] replied (" .. tostring(r.latency_ms) .. "ms)")
    return { reply = r.content, model = r.model, provider = r.provider, stub = r.stub }
  end
}`;
    case 'ai_embed':
      return `return {
  run = function(context)
    local textInput = (context.inputs and context.inputs.text) or "Poseidon multi-provider Lua automation"
    local r = ai.embed(textInput, {
      provider = (context.inputs and context.inputs.provider) or nil
    })
    flow.log("Generated " .. tostring(r.dimensions) .. "-dim embedding via " .. tostring(r.provider))
    return { provider = r.provider, model = r.model, dimensions = r.dimensions, stub = r.stub, embedding = r.embedding }
  end
}`;
    case 'crypto_hash':
      return `return {
  run = function(context)
    local payload = (context.inputs and context.inputs.payload) or "poseidon-data"
    local digest = crypto.sha256(tostring(payload))
    local mac = crypto.hmac_sha256(tostring(payload), "secret-key")
    flow.log("Computed SHA-256 & HMAC-SHA256")
    return { sha256 = digest, hmac_sha256 = mac, uuid = crypto.uuid() }
  end
}`;
    case 'file_ops':
      return `return {
  run = function(context)
    local prev = (context.inputs and context.inputs.prev) or { message = "Hello from Poseidon" }
    fs.write_json("node_output.json", { saved_at = flow.now(), data = prev })
    local readBack = fs.read_json("node_output.json")
    flow.log("Saved sandbox file node_output.json")
    return { file = "node_output.json", content = readBack }
  end
}`;
    case 'webhook_notify':
      return `return {
  run = function(context)
    local url = context.inputs and context.inputs.webhook_url
    local msg = (context.inputs and context.inputs.message) or "Poseidon workflow completed at " .. flow.now()
    if url and url ~= "" then
      local r = notify.webhook(url, { text = msg, source = "poseidon" })
      return { delivered = r.ok, status_code = r.status_code }
    end
    flow.emit("notification", { message = msg })
    return { delivered = false, logged = true, message = msg }
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
