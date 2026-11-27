import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
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

function resolveKey32(envName: string): Buffer {
  const raw = process.env[envName];
  if (raw) {
    try {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 32) return buf;
    } catch {
      // fall through
    }
    console.warn(`[poseidon] ${envName} invalid (expected 32-byte base64) — generating ephemeral key`);
  }
  return crypto.randomBytes(32);
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

// JWT middleware for /api/* (excluding health, auth, and webhook triggers)
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (
    req.path === '/health' ||
    req.path === '/auth/login' ||
    req.path === '/auth/register' ||
    req.path === '/auth/info' ||
    req.path.startsWith('/webhooks/')
  ) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ error: 'missing token' });
    return;
  }

  const token = authHeader.slice('bearer '.length).trim();
  const claims = jwtService.validateToken(token);
  if (!claims) {
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
  res.status(201).json({ token, username: cleanUser, role: 'user' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const cleanUser = (username ?? '').trim();
  const userRecord = registeredUsers.get(cleanUser);
  if (!cleanUser || !userRecord || !PasswordHasher.verify(password ?? '', userRecord.passwordHash)) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  store.addAudit('user_login', cleanUser, `Authenticated session started (${userRecord.role}).`);
  const token = jwtService.createToken({ sub: cleanUser, role: userRecord.role }, 8 * 3600);
  res.json({ token, username: cleanUser, role: userRecord.role });
});

app.get('/api/auth/me', (req, res) => {
  const user = (req as AuthedRequest).user;
  res.json({ username: user?.sub ?? adminUser, role: user?.role ?? 'admin' });
});

// ---------------- Scripts ----------------

app.get('/api/scripts', (_req, res) => {
  res.json(store.getScripts());
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
  const initialInput = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
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

app.delete('/api/fs/:name', (req, res) => {
  res.status(store.fsDelete(req.params.name) ? 204 : 404).send();
});

app.get('/api/audit', (_req, res) => {
  res.json(store.getAuditLogs());
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
