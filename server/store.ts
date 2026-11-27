import fs from 'node:fs';
import path from 'node:path';
import { AiProviderRegistry } from './aiProviders.js';
import { ConnectionRegistry } from './connections.js';
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
  category?: string;
  description?: string;
  version: number;
  created_at: string;
}

export interface KvEntry {
  key: string;
  value: unknown;
  expiresAt: number | null;
  updatedAt: string;
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
  private kvStore = new Map<string, KvEntry>();

  public readonly aiProviders: AiProviderRegistry;
  public readonly connections: ConnectionRegistry;

  private nextWorkflowId = 1;
  private nextNodeId = 1;
  private nextEdgeId = 1;
  private nextScriptId = 1;
  private nextExecutionId = 1;
  private nextStepId = 1;
  private nextCredentialId = 1;
  private nextAuditId = 1;

  constructor(private readonly vault: CredentialVault) {
    this.aiProviders = new AiProviderRegistry(vault);
    this.connections = new ConnectionRegistry(vault);
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
      model = reply.model or "stub",
      provider = reply.provider
    }
  end
}`,
      'AI',
      'Summarize upstream text using the active AI provider.'
    );

    this.createScript(
      'ai_multi_provider.lua',
      `-- Route prompts across multiple AI providers (OpenAI, Anthropic, Gemini, Groq, Ollama)
-- with automatic fallback if the primary provider is unavailable.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local prompt = inputs.prompt or "Explain event-driven workflow automation in two bullet points."
    local primary = inputs.primary or "anthropic"
    local fallback = inputs.fallback or "openai"

    local available = ai.providers()
    flow.log("Registered AI providers: " .. tostring(#available))

    local res = ai.chat({
      provider = primary,
      system = "You are a concise engineering assistant.",
      prompt = prompt,
      temperature = 0.4,
      max_tokens = 250
    })

    if not res.ok then
      flow.log("Primary provider failed (" .. tostring(res.error) .. "), falling back to " .. fallback)
      res = ai.chat({
        provider = fallback,
        prompt = prompt,
        temperature = 0.4,
        max_tokens = 250
      })
    end

    return {
      provider = res.provider,
      model = res.model,
      stub = res.stub,
      latency_ms = res.latency_ms,
      answer = res.content
    }
  end
}`,
      'AI',
      'Route AI prompts across providers with automatic fallback.'
    );

    this.createScript(
      'ai_custom_provider.lua',
      `-- Call a saved custom provider by slug OR pass an inline custom HTTP/JSON AI endpoint.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local useInline = inputs.inline == true

    local reply
    if useInline then
      local secret = context.secrets and context.secrets.custom_ai_key and context.secrets.custom_ai_key.value
      reply = ai.chat({
        base_url = inputs.base_url or "http://localhost:11434",
        api_format = inputs.api_format or "ollama",
        api_key = secret,
        model = inputs.model or "llama3.2",
        headers = { ["X-Poseidon-Workflow"] = tostring(context.node.name) },
        messages = {
          { role = "user", content = inputs.prompt or "Say hello from Poseidon custom provider!" }
        }
      })
    else
      -- Calls a configured provider from the AI Providers tab (e.g., "ollama", "groq", or your custom slug)
      reply = ai.complete(inputs.prompt or "Generate 3 Lua automation tips.", {
        provider = inputs.provider or "ollama",
        temperature = 0.6
      })
    end

    flow.log("Custom AI response from " .. tostring(reply.provider) .. " (" .. tostring(reply.latency_ms) .. "ms)")
    return reply
  end
}`,
      'AI',
      'Use a saved custom AI provider or inline base_url / api_format configuration.'
    );

    this.createScript(
      'ai_embeddings.lua',
      `-- Compute vector embeddings with ai.embed() and measure cosine similarity.
local function cosine_similarity(a, b)
  local dot, na, nb = 0, 0, 0
  for i = 1, math.min(#a, #b) do
    dot = dot + a[i] * b[i]
    na = na + a[i] * a[i]
    nb = nb + b[i] * b[i]
  end
  if na == 0 or nb == 0 then return 0 end
  return dot / (math.sqrt(na) * math.sqrt(nb))
end

return {
  run = function(context)
    local inputs = context.inputs or {}
    local queryText = inputs.query or "Lua workflow automation with encrypted WebSockets"
    local docs = inputs.docs or {
      "Poseidon executes sandboxed Lua pipelines over X25519 encrypted WebSockets.",
      "How to bake sourdough bread at home.",
      "SQL console and AES-256-GCM secret vault for automation scripts."
    }

    local qRes = ai.embed(queryText, { provider = inputs.provider })
    local dRes = ai.embed(docs, { provider = inputs.provider })

    local scored = {}
    for i, docText in ipairs(docs) do
      local vec = dRes.embeddings[i] or {}
      local sim = cosine_similarity(qRes.embedding, vec)
      table.insert(scored, { index = i, score = tonumber(string.format("%.4f", sim)), text = docText })
    end
    table.sort(scored, function(x, y) return x.score > y.score end)

    flow.log("Ranked " .. tostring(#scored) .. " documents (" .. tostring(qRes.dimensions) .. " dims)")
    return { provider = qRes.provider, stub = qRes.stub, dimensions = qRes.dimensions, ranked = scored }
  end
}`,
      'AI',
      'Compute vector embeddings and rank documents by cosine similarity.'
    );

    this.createScript(
      'csv_etl_pipeline.lua',
      `-- Parse CSV text, filter rows, save JSON/CSV output to sandbox FS, and upsert DB items.
return {
  run = function(context)
    local rawCsv = (context.inputs and context.inputs.csv) or [[sku,title,category,stock,status
PSD-201,Edge Cron Dispatcher,Automation,19,active
PSD-202,CSV Stream Parser,Data,42,active
PSD-203,Deprecated Tape Adapter,Legacy,0,archived]]

    local rows = csv.parse(rawCsv, { header = true })
    local activeRows = {}
    for _, row in ipairs(rows) do
      local stockNum = tonumber(row.stock) or 0
      if row.status == "active" and stockNum > 0 then
        table.insert(activeRows, {
          sku = row.sku,
          title = row.title,
          category = row.category,
          stock = stockNum,
          status = row.status
        })
      end
    end

    local exportedCsv = csv.stringify(activeRows)
    fs.write("exports/active_inventory.csv", exportedCsv)
    fs.write_json("exports/active_inventory.json", activeRows)
    flow.log("Parsed " .. tostring(#rows) .. " CSV rows; exported " .. tostring(#activeRows) .. " active rows")

    return {
      total_parsed = #rows,
      active_count = #activeRows,
      exported_csv = exportedCsv,
      rows = activeRows
    }
  end
}`,
      'Data',
      'Parse CSV input, transform active rows, and export CSV & JSON artifacts.'
    );

    this.createScript(
      'webhook_hmac_verify.lua',
      `-- Verify incoming webhook HMAC-SHA256 signature and deduplicate with persistent KV store.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local secret = (context.secrets and context.secrets.webhook_secret and context.secrets.webhook_secret.value) or "poseidon-dev-secret"
    local payloadObj = inputs.payload or { event_id = "evt_" .. crypto.uuid(), action = "order.paid", amount = 49.99 }
    local rawBody = inputs.raw_body or json.encode(payloadObj)
    local expectedSig = crypto.hmac_sha256(rawBody, secret)
    local providedSig = inputs.signature or expectedSig

    local valid = crypto.constant_time_equals(providedSig, expectedSig)
    if not valid then
      error("Invalid webhook signature")
    end

    local eventId = tostring(payloadObj.event_id or crypto.sha256(rawBody))
    local dedupKey = "webhook:seen:" .. eventId
    if kv.get(dedupKey) then
      flow.log("Duplicate webhook ignored: " .. eventId)
      return { accepted = false, duplicate = true, event_id = eventId }
    end

    kv.set(dedupKey, { seen_at = flow.now(), action = payloadObj.action }, 3600)
    flow.emit("webhook_verified", { event_id = eventId, action = payloadObj.action })
    flow.log("Verified and recorded webhook event " .. eventId)

    return {
      accepted = true,
      duplicate = false,
      event_id = eventId,
      signature = expectedSig
    }
  end
}`,
      'Security',
      'Validate HMAC-SHA256 webhook signatures and deduplicate events via kv.*.'
    );

    this.createScript(
      'kv_state_cursor.lua',
      `-- Maintain persistent state, counters, and sync cursors across workflow runs using kv.*.
return {
  run = function(context)
    local counterKey = "demo:run_counter"
    local prevCount = tonumber(kv.get(counterKey) or 0)
    local nextCount = prevCount + 1

    kv.set(counterKey, nextCount)
    kv.set("demo:last_run", {
      run_number = nextCount,
      timestamp = flow.now(),
      unix_ms = flow.unix_ms(),
      node = context.node.name
    }, 86400)

    local allDemoKeys = kv.list("demo:")
    flow.log("Persistent run counter = " .. tostring(nextCount) .. " (" .. tostring(#allDemoKeys) .. " keys)")

    return {
      run_number = nextCount,
      keys = allDemoKeys,
      last_run = kv.get("demo:last_run")
    }
  end
}`,
      'State',
      'Persist counters and incremental cursors across executions with kv.*.'
    );

    this.createScript(
      'text_template_report.lua',
      `-- Build formatted notifications with text.template(), text.regex_match(), and encoding helpers.
return {
  run = function(context)
    local rows = db.find("items", { status = "active" })
    local lines = {}
    for _, item in ipairs(rows) do
      table.insert(lines, text.template("- [{{sku}}] {{title}} ({{stock}} in stock)", item))
    end

    local report = text.template([[
Poseidon Inventory Report ({{date}})
Active SKUs: {{count}}
Slug Tag: {{slug}}
{{items}}
]], {
      date = flow.now(),
      count = #rows,
      slug = text.slugify("Poseidon Inventory Report"),
      items = table.concat(lines, "\\n")
    })

    fs.write("reports/latest_inventory.txt", report)
    flow.log("Generated report (" .. tostring(#report) .. " bytes)")

    return {
      report = report,
      base64_preview = encoding.base64_encode(string.sub(report, 1, 80)),
      active_count = #rows
    }
  end
}`,
      'Formatting',
      'Render structured reports using text.template, text.slugify, db.find, and fs.write.'
    );

    this.createScript(
      'http_request_crud.lua',
      `-- Unified HTTP client using http.request() with query params, JSON body, and encoding helpers.
return {
  run = function(context)
    local inputs = context.inputs or {}
    local resp = http.request({
      method = inputs.method or "POST",
      url = inputs.url or "https://jsonplaceholder.typicode.com/posts",
      query = { source = "poseidon", tag = "lua automation" },
      headers = { ["X-Request-Id"] = crypto.uuid() },
      json = {
        title = inputs.title or "Poseidon Automated Entry",
        body = "Sent from Lua http.request at " .. flow.now(),
        userId = 1
      },
      timeout_ms = 10000
    })

    flow.log("HTTP " .. tostring(resp.status_code) .. " received")
    return {
      status_code = resp.status_code,
      parsed = resp.json,
      encoded_tag = encoding.url_encode("lua automation & workflows")
    }
  end
}`,
      'Network',
      'Send structured HTTP requests with query params, JSON auto-encoding, and headers.'
    );

    this.createScript(
      'crypto_aes_vault.lua',
      `-- Encrypt/decrypt sensitive payloads with AES-256-GCM and sign digests with HMAC-SHA512.
return {
  run = function(context)
    local keyB64 = crypto.random_bytes(32)
    local message = "Poseidon secret payload @ " .. flow.now()
    local ptB64 = encoding.base64_encode(message)

    local encrypted = crypto.aes_encrypt(ptB64, keyB64)
    local decryptedB64 = crypto.aes_decrypt(encrypted, keyB64)
    local roundTrip = encoding.base64_decode(decryptedB64)
    local hmac512 = crypto.hmac_sha512(message, "signing-key")

    flow.assert(roundTrip == message, "AES round-trip mismatch")
    flow.log("AES-256-GCM round-trip verified + HMAC-SHA512 generated")

    return {
      verified = true,
      ciphertext_b64 = encrypted,
      plaintext = roundTrip,
      sha512 = crypto.sha512(message),
      hmac_sha512 = string.sub(hmac512, 1, 32) .. "..."
    }
  end
}`,
      'Security',
      'Demonstrate AES-256-GCM encryption/decryption, SHA-512, and HMAC-SHA512.'
    );

    this.createScript(
      '1000.lua',
      `local ScriptID = 1000
print("hello world from Script " .. tostring(ScriptID) .. "!")
return { script_id = ScriptID, ok = true }`,
      'Basics',
      'Minimal starter Lua script printing Hello World.'
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

    // Seed Workflow 4: Multi-Provider AI Router Blueprint
    this.createWorkflow({
      name: 'Multi-Provider AI Pipeline',
      description: 'Inspects configured AI providers, calls primary AI, and formats a templated briefing saved to sandbox FS.',
      mode: 'blueprint',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'ai_prep',
          type: 'code',
          name: 'Build Prompt',
          x: 70,
          y: 140,
          script: `return {
  run = function(context)
    local items = db.find("items", { status = "active" })
    local providers = ai.providers()
    flow.set("provider_count", #providers)
    local prompt = text.template("Summarize health for {{count}} active automation modules.", { count = #items })
    return { prompt = prompt, active_items = #items, registered_providers = #providers }
  end
}`
        },
        {
          client_id: 'ai_run',
          type: 'ai',
          name: 'AI Provider Call',
          x: 340,
          y: 140,
          script: `return {
  run = function(context)
    local prev = context.inputs.prev or {}
    local provider = (context.inputs and context.inputs.provider) or nil
    local res = ai.chat({
      provider = provider,
      system = "Be concise and technical.",
      prompt = prev.prompt or "Summarize Poseidon status."
    })
    flow.log("Provider=" .. tostring(res.provider) .. " stub=" .. tostring(res.stub))
    return res
  end
}`
        },
        {
          client_id: 'ai_save',
          type: 'file_ops',
          name: 'Save Briefing',
          x: 610,
          y: 140,
          script: `return {
  run = function(context)
    local prev = context.inputs.prev or {}
    local doc = {
      generated_at = flow.now(),
      provider = prev.provider,
      model = prev.model,
      stub = prev.stub,
      content = prev.content
    }
    fs.write_json("ai_briefing.json", doc)
    kv.set("last_ai_briefing", doc, 3600)
    return { saved = "ai_briefing.json", provider = prev.provider }
  end
}`
        }
      ],
      edges: [
        { source: 'ai_prep', target: 'ai_run', condition: 'on_success' },
        { source: 'ai_run', target: 'ai_save', condition: 'on_success' }
      ]
    });

    // Seed Workflow 5: CSV ETL & KV Deduplication Blueprint
    this.createWorkflow({
      name: 'CSV ETL & KV Sync',
      description: 'Parses CSV rows, tracks processed SKUs in persistent kv.*, and writes cleaned exports.',
      mode: 'blueprint',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'csv_in',
          type: 'csv_parse',
          name: 'Parse CSV Feed',
          x: 90,
          y: 140,
          script: `return {
  run = function(context)
    local raw = (context.inputs and context.inputs.csv) or "sku,title,stock\\nPSD-301,Webhook Signer,14\\nPSD-302,KV Cache Engine,30"
    local rows = csv.parse(raw, { header = true })
    flow.log("Parsed " .. tostring(#rows) .. " CSV rows")
    return { rows = rows }
  end
}`
        },
        {
          client_id: 'kv_sync',
          type: 'kv_store',
          name: 'KV Dedup & Export',
          x: 380,
          y: 140,
          script: `return {
  run = function(context)
    local prev = context.inputs.prev or {}
    local rows = prev.rows or {}
    local synced = 0
    for _, row in ipairs(rows) do
      local key = "sku:" .. tostring(row.sku)
      if not kv.get(key) then
        kv.set(key, row, 86400)
        synced = synced + 1
      end
    end
    local csvOut = csv.stringify(rows)
    fs.write("csv_sync_latest.csv", csvOut)
    flow.log("Synced " .. tostring(synced) .. " new SKU(s) into KV store")
    return { total = #rows, newly_synced = synced, exported_file = "csv_sync_latest.csv" }
  end
}`
        }
      ],
      edges: [{ source: 'csv_in', target: 'kv_sync', condition: 'on_success' }]
    });

    // Seed Workflow 6: Embeddings Similarity Demo
    this.createWorkflow({
      name: 'AI Embeddings Similarity',
      description: 'Computes vector embeddings via ai.embed() and ranks candidate documents by cosine similarity.',
      mode: 'code',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'emb1',
          type: 'ai_embed',
          name: 'Semantic Search',
          x: 220,
          y: 160,
          script: `return {
  run = function(context)
    local query = (context.inputs and context.inputs.query) or "Encrypted WebSocket Lua automation"
    local docs = {
      "Poseidon executes sandboxed Lua pipelines over X25519 encrypted WebSockets.",
      "Weekly grocery list: apples, bread, olive oil.",
      "Multi-provider AI routing with OpenAI, Anthropic, Gemini, and custom endpoints."
    }
    local q = ai.embed(query)
    local d = ai.embed(docs)
    local ranked = {}
    for i, text in ipairs(docs) do
      local a, b = q.embedding, d.embeddings[i] or {}
      local dot, na, nb = 0, 0, 0
      for j = 1, math.min(#a, #b) do
        dot = dot + a[j] * b[j]
        na = na + a[j] * a[j]
        nb = nb + b[j] * b[j]
      end
      local score = (na > 0 and nb > 0) and (dot / (math.sqrt(na) * math.sqrt(nb))) or 0
      table.insert(ranked, { doc = text, score = tonumber(string.format("%.4f", score)) })
    end
    table.sort(ranked, function(x, y) return x.score > y.score end)
    return { provider = q.provider, stub = q.stub, dimensions = q.dimensions, ranked = ranked }
  end
}`
        }
      ],
      edges: []
    });

    const telegramScriptPath = path.resolve(process.cwd(), 'scripts/examples/telegram_ai_bot.lua');
    let telegramBotScript = '';
    try {
      telegramBotScript = fs.readFileSync(telegramScriptPath, 'utf8');
    } catch {
      telegramBotScript = `-- Telegram AI Bot for Poseidon
return {
  run = function(context)
    local inputs = context.inputs or {}
    local secrets = context.secrets or {}
    local token = inputs.bot_token or (secrets.telegram_bot_token and secrets.telegram_bot_token.value)
    local msg = inputs.message or inputs.edited_message
    if not token and not inputs.dry_run then
      error("Missing telegram_bot_token in Vault or inputs.bot_token")
    end
    if type(msg) ~= "table" or not msg.chat then
      return { ok = true, note = "Pass inputs.message or configure scripts/examples/telegram_ai_bot.lua" }
    end
    local reply = ai.chat({ provider = inputs.provider, prompt = tostring(msg.text or "") })
    if not inputs.dry_run then
      http.post("https://api.telegram.org/bot" .. token .. "/sendMessage", { chat_id = msg.chat.id, text = reply.content })
    end
    return { chat_id = msg.chat.id, reply = reply.content, provider = reply.provider }
  end
}`;
    }

    this.createScript(
      'telegram_ai_bot.lua',
      telegramBotScript,
      'Integrations',
      'Talk to any Poseidon AI provider from Telegram via webhook or getUpdates polling with per-chat kv.* memory and slash commands.'
    );

    // Seed Workflow 7: Telegram AI Chat Bot
    this.createWorkflow({
      name: 'Telegram AI Chat Bot',
      description: 'Connects a Telegram bot to Poseidon AI providers (supports webhook updates and scheduled getUpdates polling with per-chat conversation history).',
      mode: 'code',
      trigger_type: 'manual',
      is_active: true,
      nodes: [
        {
          client_id: 'tg1',
          type: 'code',
          name: 'Telegram AI Bot',
          x: 220,
          y: 160,
          script: telegramBotScript
        }
      ],
      edges: []
    });

    this.virtualFs.set('welcome.txt', `Poseidon sandbox initialized at ${now}`);
    this.virtualFs.set('config.json', JSON.stringify({ environment: 'development', maxRetries: 3 }, null, 2));
    this.kvSet('system:boot_at', now);
    this.kvSet('system:version', '2.0.0-web');
    this.addAudit('system_boot', 'system', 'Seeded workflows, Lua script templates, AI provider presets, KV store, and database tables.');
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

  // ---------- KV Store (Persistent across runs) ----------

  kvGet(key: string): unknown {
    const entry = this.kvStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.kvStore.delete(key);
      return null;
    }
    return entry.value;
  }

  kvSet(key: string, value: unknown, ttlSeconds?: number | null): KvEntry {
    const expiresAt =
      typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? Date.now() + Math.round(ttlSeconds * 1000)
        : null;
    const entry: KvEntry = {
      key,
      value,
      expiresAt,
      updatedAt: new Date().toISOString()
    };
    this.kvStore.set(key, entry);
    return entry;
  }

  kvDelete(key: string): boolean {
    return this.kvStore.delete(key);
  }

  kvList(prefix?: string): Array<{ key: string; value: unknown; updatedAt: string }> {
    const now = Date.now();
    const out: Array<{ key: string; value: unknown; updatedAt: string }> = [];
    for (const [k, entry] of this.kvStore.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.kvStore.delete(k);
        continue;
      }
      if (!prefix || k.startsWith(prefix)) {
        out.push({ key: k, value: entry.value, updatedAt: entry.updatedAt });
      }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  // ---------- Scripts ----------

  getScripts(): ScriptRecord[] {
    return Array.from(this.scripts.values()).sort((a, b) => a.id - b.id);
  }

  createScript(name: string, content: string, category?: string, description?: string): ScriptRecord {
    const record: ScriptRecord = {
      id: this.nextScriptId++,
      name: name.trim(),
      content,
      category: category?.trim() || 'Custom',
      description: description?.trim() || '',
      version: 1,
      created_at: new Date().toISOString()
    };
    this.scripts.set(record.id, record);
    return record;
  }

  deleteScript(id: number): boolean {
    return this.scripts.delete(id);
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
    const secrets: Record<string, Record<string, unknown>> = {
      ...this.connections.getSecretsMapContributions()
    };
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
        columns: ['id', 'name', 'category', 'version', 'created_at'],
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
        name: 'ai_providers',
        kind: 'system',
        columns: ['id', 'name', 'apiFormat', 'defaultModel', 'isDefault', 'hasApiKey', 'enabled'],
        rowCount: this.aiProviders.listPublic().length
      },
      {
        name: 'connections',
        kind: 'system',
        columns: ['id', 'name', 'label', 'category', 'endpointUrl', 'hasToken', 'enabled'],
        rowCount: this.connections.listPublic().length
      },
      {
        name: 'kv_store',
        kind: 'system',
        columns: ['key', 'value', 'updatedAt'],
        rowCount: this.kvList().length
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

  findCustomRows(tableName: string, where?: Record<string, unknown>): Array<Record<string, unknown>> {
    const rows = this.getRawTableRows(tableName.toLowerCase());
    if (!where || Object.keys(where).length === 0) return rows;
    return rows.filter(row =>
      Object.entries(where).every(([k, v]) => {
        if (v === undefined) return true;
        return String(row[k]) === String(v);
      })
    );
  }

  updateCustomRows(
    tableName: string,
    idOrWhere: number | string | Record<string, unknown>,
    patch: Record<string, unknown>
  ): number {
    const table = this.customTables.get(tableName.toLowerCase());
    if (!table) throw new Error(`Custom table "${tableName}" not found`);
    const filterObj: Record<string, unknown> =
      typeof idOrWhere === 'object' && idOrWhere !== null ? idOrWhere : { id: idOrWhere };

    let updated = 0;
    for (const row of table.rows) {
      const matches = Object.entries(filterObj).every(([k, v]) => String(row[k]) === String(v));
      if (!matches) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (!table.columns.includes(k)) table.columns.push(k);
        row[k] = v;
      }
      if (table.columns.includes('updated_at')) {
        row.updated_at = new Date().toISOString();
      }
      updated++;
    }
    return updated;
  }

  deleteCustomRows(tableName: string, idOrWhere: number | string | Record<string, unknown>): number {
    const table = this.customTables.get(tableName.toLowerCase());
    if (!table) throw new Error(`Custom table "${tableName}" not found`);
    const filterObj: Record<string, unknown> =
      typeof idOrWhere === 'object' && idOrWhere !== null ? idOrWhere : { id: idOrWhere };
    const before = table.rows.length;
    table.rows = table.rows.filter(
      row => !Object.entries(filterObj).every(([k, v]) => String(row[k]) === String(v))
    );
    return before - table.rows.length;
  }

  countTableRows(tableName: string): number {
    return this.getRawTableRows(tableName.toLowerCase()).length;
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
    return [
      'workflows',
      'workflow_nodes',
      'workflow_edges',
      'scripts',
      'executions',
      'execution_steps',
      'ai_providers',
      'connections',
      'kv_store',
      'credentials',
      'audit_log'
    ].includes(name.toLowerCase());
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
          category: s.category ?? 'Custom',
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
      case 'ai_providers':
        return this.aiProviders.listPublic().map(p => ({
          id: p.id,
          name: p.name,
          apiFormat: p.apiFormat,
          defaultModel: p.defaultModel,
          isDefault: p.isDefault,
          hasApiKey: p.hasApiKey,
          enabled: p.enabled
        }));
      case 'connections':
        return this.connections.listPublic().map(c => ({
          id: c.id,
          name: c.name,
          label: c.label,
          category: c.category,
          endpointUrl: c.endpointUrl,
          hasToken: c.hasToken,
          enabled: c.enabled
        }));
      case 'kv_store':
        return this.kvList().map(entry => ({
          key: entry.key,
          value: typeof entry.value === 'object' ? JSON.stringify(entry.value) : entry.value,
          updatedAt: entry.updatedAt
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

    // COUNT(*)
    const countMatch = selectClause.match(/^count\s*\(\s*\*\s*\)(?:\s+as\s+([a-z0-9_]+))?$/i);
    if (countMatch) {
      const colName = countMatch[1] || 'count';
      return [{ [colName]: rows.length }];
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
