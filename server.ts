import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AiChatRequest, UpsertAiProviderInput } from './server/aiProviders.js';
import type { UpsertConnectionInput } from './server/connections.js';
import { CredentialVault, JwtService, PasswordHasher, SecureChannel } from './server/crypto.js';
import {
  PoseidonStore,
  type TriggerMode,
  type WorkflowSaveEdgeInput,
  type WorkflowSaveNodeInput
} from './server/store.js';
import { SessionManager } from './server/sessionManager.js';
import { WorkflowEngine } from './server/workflowEngine.js';

dotenv.config();

const DEV_KEYS_PATH = path.resolve(process.cwd(), '.poseidon-dev-keys.json');

function loadDevKeys(): Record<string, string> {
  try {
    if (fs.existsSync(DEV_KEYS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DEV_KEYS_PATH, 'utf8')) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore malformed dev key file
  }
  return {};
}

function saveDevKeys(keys: Record<string, string>): void {
  try {
    fs.writeFileSync(DEV_KEYS_PATH, JSON.stringify(keys, null, 2), { mode: 0o600 });
  } catch {
    // ignore write failure in read-only env
  }
}

function resolveKey32(envName: string): Buffer {
  const raw = process.env[envName];
  if (raw) {
    try {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 32) return buf;
    } catch {
      // fall through
    }
    console.warn(`[poseidon] ${envName} invalid (expected 32-byte base64) — falling back to persisted dev key`);
  }

  const devKeys = loadDevKeys();
  if (devKeys[envName]) {
    try {
      const buf = Buffer.from(devKeys[envName], 'base64');
      if (buf.length === 32) return buf;
    } catch {
      // fall through
    }
  }

  const generated = crypto.randomBytes(32);
  devKeys[envName] = generated.toString('base64');
  saveDevKeys(devKeys);
  return generated;
}

const masterKey = resolveKey32('POSEIDON_MASTER_KEY');
const jwtKey = resolveKey32('POSEIDON_JWT_KEY');
const adminUser = process.env.POSEIDON_ADMIN_USER || 'admin';
const configuredHash = process.env.POSEIDON_ADMIN_PASSWORD_HASH?.trim();
const hasValidConfiguredHash = Boolean(configuredHash && configuredHash.startsWith('$pbkdf2v1$'));
const adminPasswordHash = hasValidConfiguredHash ? configuredHash! : PasswordHasher.hash('poseidon');
const usingDefaultCredentials = !hasValidConfiguredHash;

const vault = new CredentialVault(masterKey);
const jwtService = new JwtService(jwtKey);
const store = new PoseidonStore(vault);
const sessions = new SessionManager();
const engine = new WorkflowEngine(store);
const registeredUsers = new Map<string, { passwordHash: string; role: 'admin' | 'user' }>();
registeredUsers.set(adminUser, { passwordHash: adminPasswordHash, role: 'admin' });
if (!registeredUsers.has('testadmin')) {
  registeredUsers.set('testadmin', {
    passwordHash: PasswordHasher.hash(process.env.POSEIDON_TEST_PASSWORD || 'poseidon123'),
    role: 'admin'
  });
}

type AuthedRequest = Request & { user?: Record<string, unknown> };

const app = express();
app.use(express.json({ limit: '2mb' }));

function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  const origin = String(req.headers.origin ?? '').toLowerCase();
  const referer = String(req.headers.referer ?? '').toLowerCase();
  return req.secure || forwardedProto.includes('https') || origin.startsWith('https://') || referer.startsWith('https://');
}

function setAuthCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  const attrs = isHttps
    ? 'Path=/; HttpOnly; SameSite=None; Secure; Max-Age=28800'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=28800';
  res.setHeader('Set-Cookie', `poseidon_jwt=${encodeURIComponent(token)}; ${attrs}`);
}

function clearAuthCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const attrs = isHttps
    ? 'Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', `poseidon_jwt=; ${attrs}`);
}

// JWT middleware for /api/* (excluding health, auth, and webhook triggers)
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');

  if (
    req.path === '/health' ||
    req.path === '/auth/login' ||
    req.path === '/auth/register' ||
    req.path === '/auth/logout' ||
    req.path === '/auth/info' ||
    req.path.startsWith('/webhooks/')
  ) {
    next();
    return;
  }

  const candidates: string[] = [];
  const xToken = req.headers['x-poseidon-token'];
  if (typeof xToken === 'string' && xToken.trim()) {
    candidates.push(xToken.trim());
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice('bearer '.length).trim();
    if (bearer) candidates.push(bearer);
  }
  const cookieToken = parseCookieValue(req.headers.cookie, 'poseidon_jwt');
  if (cookieToken) {
    candidates.push(cookieToken);
  }
  const queryToken = req.query.__poseidon_token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    candidates.push(queryToken.trim());
  }

  if (candidates.length === 0) {
    console.warn(
      `[poseidon:auth] 401 missing token on ${req.method} ${req.path} (headerKeys=${Object.keys(req.headers).join(',')})`
    );
    res.status(401).json({ error: 'missing token' });
    return;
  }

  let claims: Record<string, unknown> | null = null;
  for (const cand of candidates) {
    claims = jwtService.validateToken(cand);
    if (claims) break;
  }

  if (!claims) {
    console.warn(
      `[poseidon:auth] 401 invalid token on ${req.method} ${req.path} (xToken=${Boolean(xToken)} auth=${Boolean(authHeader)} cookie=${Boolean(cookieToken)} query=${Boolean(queryToken)})`
    );
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  (req as AuthedRequest).user = claims;
  next();
});

function getActor(req: Request): string {
  return String((req as AuthedRequest).user?.sub ?? 'anonymous');
}

// ---------------- Auth ----------------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'poseidon', sessions: sessions.count });
});

app.get('/api/auth/info', (_req, res) => {
  res.json({
    defaultUsername: usingDefaultCredentials ? adminUser : 'testadmin',
    hasDefaultDemoPassword: usingDefaultCredentials
  });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const cleanUser = (username ?? '').trim();
  if (!cleanUser || cleanUser.length < 2) {
    res.status(400).json({ error: 'username must be at least 2 characters' });
    return;
  }
  if (!password || password.length < 4) {
    res.status(400).json({ error: 'password must be at least 4 characters' });
    return;
  }
  if (registeredUsers.has(cleanUser)) {
    res.status(409).json({ error: 'username already exists' });
    return;
  }
  registeredUsers.set(cleanUser, { passwordHash: PasswordHasher.hash(password), role: 'user' });
  store.addAudit('user_registered', cleanUser, `Registered new user account "${cleanUser}".`);
  const token = jwtService.createToken({ sub: cleanUser, role: 'user' }, 8 * 3600);
  setAuthCookie(req, res, token);
  console.log(`[poseidon:auth] registered user="${cleanUser}"`);
  res.status(201).json({ token, username: cleanUser, role: 'user' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const cleanUser = (username ?? '').trim();
  const userRecord = registeredUsers.get(cleanUser);
  if (!cleanUser || !userRecord || !PasswordHasher.verify(password ?? '', userRecord.passwordHash)) {
    console.warn(`[poseidon:auth] 401 bad credentials for user="${cleanUser}"`);
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  store.addAudit('user_login', cleanUser, `Authenticated session started (${userRecord.role}).`);
  const token = jwtService.createToken({ sub: cleanUser, role: userRecord.role }, 8 * 3600);
  setAuthCookie(req, res, token);
  console.log(`[poseidon:auth] login success user="${cleanUser}" role="${userRecord.role}"`);
  res.json({ token, username: cleanUser, role: userRecord.role });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = (req as AuthedRequest).user;
  res.json({ username: user?.sub ?? adminUser, role: user?.role ?? 'admin' });
});

// ---------------- Scripts ----------------

app.get('/api/scripts', (_req, res) => {
  res.json(store.getScripts());
});

app.post('/api/scripts', (req, res) => {
  const { name, content, category, description } = (req.body ?? {}) as {
    name?: string;
    content?: string;
    category?: string;
    description?: string;
  };
  if (!name?.trim() || typeof content !== 'string') {
    res.status(400).json({ error: 'name and content are required' });
    return;
  }
  const created = store.createScript(name.trim(), content, category, description);
  store.addAudit('script_created', getActor(req), `Created Lua script template "${created.name}".`);
  res.status(201).json(created);
});

app.delete('/api/scripts/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const deleted = store.deleteScript(id);
  res.status(deleted ? 204 : 404).send();
});

// ---------------- Workflows ----------------

app.get('/api/workflows', (_req, res) => {
  res.json(store.getWorkflows());
});

app.get('/api/workflows/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const wf = store.getWorkflow(id);
  if (!wf) {
    res.status(404).json({ error: 'workflow not found' });
    return;
  }
  res.json(wf);
});

app.post('/api/workflows', (req, res) => {
  const body = (req.body ?? {}) as {
    name?: string;
    description?: string | null;
    mode?: 'blueprint' | 'code';
    trigger_type?: TriggerMode;
    schedule_seconds?: number | null;
    is_active?: boolean;
    nodes?: WorkflowSaveNodeInput[];
    edges?: WorkflowSaveEdgeInput[];
    script?: string;
  };

  if (!body.name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  let nodes = body.nodes ?? [];
  const edges = body.edges ?? [];

  if (nodes.length === 0 && typeof body.script === 'string') {
    nodes = [{ client_id: 'code1', type: 'code', name: body.name, script: body.script, x: 200, y: 160 }];
  }

  const created = store.createWorkflow({
    name: body.name,
    description: body.description ?? null,
    mode: body.mode,
    trigger_type: body.trigger_type,
    schedule_seconds: body.schedule_seconds ?? null,
    is_active: body.is_active ?? true,
    nodes,
    edges
  });
  store.addAudit('workflow_created', getActor(req), `Created ${created.mode} "${created.name}" (#${created.id}).`);
  res.status(201).json(created);
});

app.put('/api/workflows/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const body = (req.body ?? {}) as {
    name?: string;
    description?: string | null;
    mode?: 'blueprint' | 'code';
    trigger_type?: TriggerMode;
    schedule_seconds?: number | null;
    is_active?: boolean;
    nodes?: WorkflowSaveNodeInput[];
    edges?: WorkflowSaveEdgeInput[];
  };

  const updated = store.updateWorkflow(id, body);
  if (!updated) {
    res.status(404).json({ error: 'workflow not found' });
    return;
  }
  store.addAudit('workflow_updated', getActor(req), `Updated "${updated.name}" (#${updated.id}).`);
  res.json(updated);
});

app.post('/api/workflows/:id/clone', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const cloned = store.cloneWorkflow(id);
  if (!cloned) {
    res.status(404).json({ error: 'workflow not found' });
    return;
  }
  store.addAudit('workflow_cloned', getActor(req), `Cloned workflow #${id} -> #${cloned.id}.`);
  res.status(201).json(cloned);
});

app.delete('/api/workflows/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  engine.stopWorkflowExecutions(id);
  const deleted = store.deleteWorkflow(id);
  if (!deleted) {
    res.status(404).json({ error: 'workflow not found' });
    return;
  }
  store.addAudit('workflow_deleted', getActor(req), `Deleted workflow #${id}.`);
  res.status(204).send();
});

// ---------------- Executions & Webhooks ----------------

function startWorkflowExecution(
  workflowId: number,
  triggerType: string,
  initialInput: Record<string, unknown>
) {
  const inputJson = Object.keys(initialInput).length > 0 ? JSON.stringify(initialInput) : null;
  const execution = store.createExecution(workflowId, triggerType, inputJson);

  void engine.executeAsync(workflowId, execution.id, initialInput, {
    onStep: stepEvent => {
      sessions.broadcast({ type: 'step', ...stepEvent });
    },
    onLog: (execId, wfId, nodeId, message) => {
      sessions.broadcast({
        type: 'flow_log',
        execution_id: execId,
        workflow_id: wfId,
        node_id: nodeId,
        message
      });
    },
    onEvent: (execId, wfId, nodeId, eventName, payload) => {
      sessions.broadcast({
        type: 'flow_event',
        execution_id: execId,
        workflow_id: wfId,
        node_id: nodeId,
        event: eventName,
        payload
      });
    },
    onComplete: (execId, wfId, status, outputJson, error) => {
      sessions.broadcast({
        type: 'execution_finished',
        execution_id: execId,
        workflow_id: wfId,
        status,
        output: outputJson,
        error
      });
    }
  });

  return execution;
}

app.post('/api/workflows/:id/execute', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const wf = store.getWorkflow(id);
  if (!wf) {
    res.status(404).json({ error: 'workflow not found' });
    return;
  }

  const body = (req.body ?? {}) as { triggerType?: string; inputJson?: Record<string, unknown>; inputs?: Record<string, unknown> };
  const initialInput = body.inputs ?? body.inputJson ?? {};
  const execution = startWorkflowExecution(id, body.triggerType ?? 'manual', initialInput);
  store.addAudit('workflow_executed', getActor(req), `Started "${wf.name}" (#${id}) execution #${execution.id}.`);
  res.status(202).json({ executionId: execution.id, execution });
});

app.post('/api/webhooks/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const wf = store.getWorkflow(id);
  if (!wf || !wf.is_active) {
    res.status(404).json({ error: 'active workflow not found' });
    return;
  }
  const initialInput = (req.body && typeof req.body === 'object' ? { ...req.body } : {}) as Record<string, unknown>;
  const tgSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof tgSecret === 'string' && tgSecret.length > 0) {
    initialInput._telegram_secret = tgSecret;
  }
  const execution = startWorkflowExecution(id, 'webhook', initialInput);
  store.addAudit('webhook_triggered', 'webhook', `Webhook triggered "${wf.name}" (#${id}) -> execution #${execution.id}.`);
  res.status(202).json({ executionId: execution.id, status: execution.status });
});

app.post('/api/workflows/:id/stop', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const stoppedCount = engine.stopWorkflowExecutions(id);
  store.addAudit('workflow_stopped', getActor(req), `Stopped workflow #${id} (${stoppedCount} active run(s)).`);
  res.json({ workflowId: id, stoppedCount });
});

app.get('/api/executions', (req, res) => {
  const wfIdParam = req.query.workflowId as string | undefined;
  const wfId = wfIdParam ? Number.parseInt(wfIdParam, 10) : undefined;
  res.json(store.getExecutions(wfId));
});

app.get('/api/executions/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const exec = store.getExecution(id);
  if (!exec) {
    res.status(404).json({ error: 'execution not found' });
    return;
  }
  res.json({ ...exec, steps: store.getSteps(id) });
});

app.get('/api/executions/:id/steps', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  res.json({ id, steps: store.getSteps(id) });
});

app.post('/api/executions/:id/stop', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const stopped = engine.stopExecution(id);
  if (!stopped) {
    const exec = store.getExecution(id);
    if (exec && (exec.status === 'running' || exec.status === 'queued')) {
      store.updateExecutionStatus(id, 'cancelled', null, 'Stopped by user');
    }
  }
  store.addAudit('execution_stopped', getActor(req), `Stopped execution #${id}.`);
  res.json({ executionId: id, stopped: true });
});

// ---------------- Database Management & SQL Console ----------------

app.get('/api/db/tables', (_req, res) => {
  res.json(store.listTables());
});

app.get('/api/db/tables/:name', (req, res) => {
  const data = store.getTableData(req.params.name);
  if (!data) {
    res.status(404).json({ error: `Table "${req.params.name}" not found` });
    return;
  }
  res.json(data);
});

app.post('/api/db/tables', (req, res) => {
  const { name, columns } = (req.body ?? {}) as { name?: string; columns?: string[] };
  if (!name || !Array.isArray(columns) || columns.length === 0) {
    res.status(400).json({ error: 'name and columns[] are required' });
    return;
  }
  try {
    const created = store.createCustomTable(name, columns);
    store.addAudit('table_created', getActor(req), `Created database table "${created.name}".`);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/db/tables/:name', (req, res) => {
  const dropped = store.dropCustomTable(req.params.name);
  if (!dropped) {
    res.status(404).json({ error: 'Custom table not found or system table cannot be dropped' });
    return;
  }
  store.addAudit('table_dropped', getActor(req), `Dropped custom table "${req.params.name}".`);
  res.status(204).send();
});

app.post('/api/db/tables/:name/rows', (req, res) => {
  try {
    const row = store.insertCustomRow(req.params.name, (req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/db/tables/:name/rows/:rowId', (req, res) => {
  const rowId = Number.parseInt(req.params.rowId, 10);
  const deleted = store.deleteCustomRowByIndex(req.params.name, rowId);
  res.status(deleted ? 204 : 404).send();
});

app.post('/api/db/query', (req, res) => {
  const { sql } = (req.body ?? {}) as { sql?: string };
  if (!sql || !sql.trim()) {
    res.status(400).json({ error: 'sql statement is required' });
    return;
  }
  const started = Date.now();
  try {
    const result = store.runSqlStatement(sql);
    store.addAudit('sql_executed', getActor(req), sql.trim().slice(0, 120));
    res.json({ ...result, durationMs: Date.now() - started });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------- Sandbox Files & Audit Log ----------------

app.get('/api/fs', (_req, res) => {
  const files = store.fsList().map(name => ({ name, content: store.fsRead(name) ?? '' }));
  res.json(files);
});

app.post('/api/fs', (req, res) => {
  const { name, content } = (req.body ?? {}) as { name?: string; content?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'file name is required' });
    return;
  }
  try {
    store.fsWrite(name.trim(), content ?? '');
    res.status(201).json({ name: name.trim(), content: content ?? '' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/fs/*', (req, res) => {
  const fileName = decodeURIComponent(req.path.replace(/^\/api\/fs\//, ''));
  res.status(store.fsDelete(fileName) ? 204 : 404).send();
});

app.get('/api/audit', (_req, res) => {
  res.json(store.getAuditLogs());
});

// ---------------- KV Store ----------------

app.get('/api/kv', (req, res) => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
  res.json(store.kvList(prefix));
});

app.delete('/api/kv/:key', (req, res) => {
  res.status(store.kvDelete(req.params.key) ? 204 : 404).send();
});

// ---------------- AI Providers & Custom Connections ----------------

app.get('/api/ai/presets', (_req, res) => {
  res.json(store.aiProviders.getPresets());
});

app.get('/api/ai/providers', (_req, res) => {
  res.json(store.aiProviders.listPublic());
});

app.post('/api/ai/providers', (req, res) => {
  const body = (req.body ?? {}) as Partial<UpsertAiProviderInput>;
  if (!body.name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const saved = store.aiProviders.upsertProvider({
    ...(body as UpsertAiProviderInput),
    name: body.name.trim()
  });
  store.addAudit(
    'ai_provider_saved',
    getActor(req),
    `Saved AI provider "${saved.name}" (${saved.id}, format=${saved.apiFormat}${saved.isCustom ? ', custom' : ''}).`
  );
  res.status(201).json(saved);
});

app.put('/api/ai/providers/:id', (req, res) => {
  const body = (req.body ?? {}) as Partial<UpsertAiProviderInput>;
  const existing = store.aiProviders.getPublic(req.params.id);
  const saved = store.aiProviders.upsertProvider({
    ...(body as UpsertAiProviderInput),
    id: req.params.id,
    name: body.name?.trim() || existing?.name || req.params.id
  });
  store.addAudit('ai_provider_updated', getActor(req), `Updated AI provider "${saved.name}" (${saved.id}).`);
  res.json(saved);
});

app.post('/api/ai/providers/:id/default', (req, res) => {
  const updated = store.aiProviders.setDefault(req.params.id);
  if (!updated) {
    res.status(404).json({ error: 'AI provider not found' });
    return;
  }
  store.addAudit('ai_provider_default', getActor(req), `Set default AI provider to "${updated.name}" (${updated.id}).`);
  res.json(updated);
});

app.post('/api/ai/providers/:id/test', async (req, res) => {
  const result = await store.aiProviders.testProvider(req.params.id);
  store.addAudit('ai_provider_tested', getActor(req), `Tested AI provider "${req.params.id}": ${result.message}`);
  res.json(result);
});

app.delete('/api/ai/providers/:id', (req, res) => {
  const deleted = store.aiProviders.deleteProvider(req.params.id);
  if (deleted) {
    store.addAudit('ai_provider_deleted', getActor(req), `Deleted AI provider "${req.params.id}".`);
  }
  res.status(deleted ? 204 : 404).send();
});

app.post('/api/ai/chat', async (req, res) => {
  const payload = (req.body ?? {}) as AiChatRequest;
  const reply = await store.aiProviders.chat(payload);
  res.json(reply);
});

// ---------------- Credentials (AES-256-GCM encrypted) ----------------

app.get('/api/credentials', (_req, res) => {
  res.json(store.listCredentials());
});

app.post('/api/credentials', (req, res) => {
  const { name, type, data } = (req.body ?? {}) as {
    name?: string;
    type?: string;
    data?: Record<string, unknown>;
  };
  if (!name || !type || !data) {
    res.status(400).json({ error: 'name, type, and data are required' });
    return;
  }
  const rec = store.saveCredential(name, type, data);
  store.addAudit('credential_saved', getActor(req), `Saved encrypted credential "${rec.name}" (${rec.type}).`);
  res.status(201).json({ id: rec.id, name: rec.name, type: rec.type, created_at: rec.created_at });
});

app.delete('/api/credentials/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  res.status(store.deleteCredential(id) ? 204 : 404).send();
});

// ---------------- Connections (Bots, Webhooks & Tokens) ----------------

app.get('/api/connections/presets', (_req, res) => {
  res.json(store.connections.getPresets());
});

app.get('/api/connections', (_req, res) => {
  res.json(store.connections.listPublic());
});

app.post('/api/connections', (req, res) => {
  const body = (req.body ?? {}) as Partial<UpsertConnectionInput>;
  if (!body.name?.trim()) {
    res.status(400).json({ error: 'Connection name is required' });
    return;
  }
  try {
    const saved = store.connections.upsertConnection({
      ...(body as UpsertConnectionInput),
      name: body.name.trim()
    });
    store.addAudit(
      'connection_saved',
      getActor(req),
      `Saved ${saved.category} connection "${saved.name}" (${saved.label}).`
    );
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/connections/:id', (req, res) => {
  const body = (req.body ?? {}) as Partial<UpsertConnectionInput>;
  const existing = store.connections.getPublic(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  try {
    const saved = store.connections.upsertConnection({
      ...(body as UpsertConnectionInput),
      id: existing.id,
      name: body.name?.trim() || existing.name
    });
    store.addAudit(
      'connection_updated',
      getActor(req),
      `Updated ${saved.category} connection "${saved.name}" (${saved.label}).`
    );
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/connections/:id', (req, res) => {
  const deleted = store.connections.deleteConnection(req.params.id);
  if (deleted) {
    store.addAudit('connection_deleted', getActor(req), `Deleted connection "${req.params.id}".`);
  }
  res.status(deleted ? 204 : 404).send();
});

app.post('/api/connections/:id/test', async (req, res) => {
  const body = (req.body ?? {}) as { sendPing?: boolean; pingMessage?: string };
  const result = await store.connections.testConnection(req.params.id, body);
  store.addAudit('connection_tested', getActor(req), `Tested connection "${req.params.id}": ${result.message}`);
  res.json(result);
});

app.post('/api/connections/:id/telegram/webhook-info', async (req, res) => {
  const result = await store.connections.inspectTelegramWebhook(req.params.id);
  res.json(result);
});

app.post('/api/connections/:id/telegram/set-webhook', async (req, res) => {
  const body = (req.body ?? {}) as { webhookUrl?: string; dropPendingUpdates?: boolean };
  const result = await store.connections.setTelegramWebhook(
    req.params.id,
    body.webhookUrl ?? '',
    Boolean(body.dropPendingUpdates)
  );
  store.addAudit(
    'telegram_webhook_updated',
    getActor(req),
    `Telegram webhook for "${req.params.id}": ${result.message}`
  );
  res.json(result);
});

// ---------------- Lightweight Workflow Schedule Runner ----------------

const lastScheduledRun = new Map<number, number>();
setInterval(() => {
  const now = Date.now();
  for (const wf of store.getWorkflows()) {
    if (!wf.is_active || wf.trigger_type !== 'schedule') continue;
    const intervalMs = Math.max(5, wf.schedule_seconds ?? 60) * 1000;
    const prev = lastScheduledRun.get(wf.id) ?? 0;
    if (now - prev >= intervalMs) {
      lastScheduledRun.set(wf.id, now);
      startWorkflowExecution(wf.id, 'schedule', {});
    }
  }
}, 5000);

// ---------------- HTTP + Encrypted WebSocket + Vite/Static ----------------

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  const channel = new SecureChannel();
  const sessionId = sessions.add(channel, ws);
  let handshakeComplete = false;

  channel.sendHello(ws);

  ws.on('message', async (rawData: Buffer) => {
    const text = rawData.toString('utf8');
    try {
      if (!handshakeComplete) {
        const msg = JSON.parse(text) as { type?: string; client_key?: string; jwt?: string };
        if (msg.type !== 'channel_ready' || !msg.client_key) {
          ws.close(1008, 'Expected channel_ready');
          return;
        }
        const clientKeyBuf = Buffer.from(msg.client_key, 'base64');
        channel.establish(clientKeyBuf);

        if (msg.jwt && !jwtService.validateToken(msg.jwt)) {
          channel.sendFrame(ws, { type: 'error', error: 'unauthorized' });
          ws.close(1008, 'Unauthorized');
          return;
        }

        handshakeComplete = true;
        channel.sendFrame(ws, { type: 'channel_established' });
        return;
      }

      const decrypted = channel.decrypt(text);
      const cmd = JSON.parse(decrypted) as {
        type?: string;
        workflow_id?: number;
        execution_id?: number;
        inputs?: Record<string, unknown>;
      };

      if (cmd.type === 'ping') {
        channel.sendFrame(ws, { type: 'pong' });
      } else if (cmd.type === 'execute_workflow' && cmd.workflow_id) {
        const wf = store.getWorkflow(cmd.workflow_id);
        if (!wf) {
          channel.sendFrame(ws, { type: 'error', error: `Workflow ${cmd.workflow_id} not found` });
          return;
        }
        const exec = startWorkflowExecution(cmd.workflow_id, 'websocket', cmd.inputs ?? {});
        channel.sendFrame(ws, { type: 'execution_started', execution_id: exec.id, workflow_id: cmd.workflow_id });
      } else if (cmd.type === 'stop_execution' && cmd.execution_id) {
        engine.stopExecution(cmd.execution_id);
        channel.sendFrame(ws, { type: 'execution_stopping', execution_id: cmd.execution_id });
      }
    } catch (err) {
      if (channel.isEncrypted) {
        try {
          channel.sendFrame(ws, { type: 'error', error: (err as Error).message });
        } catch {
          // ignore
        }
      }
    }
  });

  ws.on('close', () => {
    sessions.remove(sessionId);
  });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[poseidon] Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch(err => {
  console.error('[poseidon] Fatal startup error:', err);
  process.exit(1);
});
