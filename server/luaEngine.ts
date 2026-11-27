import crypto from 'node:crypto';
import fengari from 'fengari';
import { AesGcmEncryption } from './crypto.js';
import type { PoseidonStore } from './store.js';
import type { AiChatRequest } from './aiProviders.js';

const { lua, lauxlib, lualib, to_luastring } = fengari;

export interface LuaExecutionOptions {
  store: PoseidonStore;
  sharedState: Map<string, unknown>;
  log: (msg: string) => void;
  emitEvent?: (eventName: string, payload: unknown) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function pushJsValue(L: unknown, val: unknown, seen = new WeakSet<object>()): void {
  if (val === null || val === undefined) {
    lua.lua_pushnil(L);
    return;
  }
  if (typeof val === 'boolean') {
    lua.lua_pushboolean(L, val);
    return;
  }
  if (typeof val === 'number') {
    lua.lua_pushnumber(L, Number.isFinite(val) ? val : 0);
    return;
  }
  if (typeof val === 'string') {
    lua.lua_pushstring(L, to_luastring(val));
    return;
  }
  if (Array.isArray(val)) {
    lua.lua_newtable(L);
    for (let i = 0; i < val.length; i++) {
      pushJsValue(L, val[i], seen);
      lua.lua_rawseti(L, -2, i + 1);
    }
    return;
  }
  if (typeof val === 'object') {
    if (seen.has(val)) {
      lua.lua_pushnil(L);
      return;
    }
    seen.add(val);
    lua.lua_newtable(L);
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      lua.lua_pushstring(L, to_luastring(k));
      pushJsValue(L, v, seen);
      lua.lua_settable(L, -3);
    }
    return;
  }
  lua.lua_pushstring(L, to_luastring(String(val)));
}

function readLuaValue(L: unknown, idx: number, depth = 0): unknown {
  if (depth > 16) return null;
  const absIdx = idx < 0 ? lua.lua_gettop(L) + idx + 1 : idx;
  const t = lua.lua_type(L, absIdx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, absIdx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, absIdx);
  if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(L, absIdx);
  if (t === lua.LUA_TTABLE) {
    const obj: Record<string, unknown> = {};
    const arr: unknown[] = [];
    let isArray = true;
    let count = 0;

    lua.lua_pushnil(L);
    while (lua.lua_next(L, absIdx) !== 0) {
      const keyType = lua.lua_type(L, -2);
      const val = readLuaValue(L, -1, depth + 1);
      if (keyType === lua.LUA_TNUMBER) {
        const numKey = lua.lua_tonumber(L, -2);
        obj[String(numKey)] = val;
        if (Number.isInteger(numKey) && numKey >= 1) {
          arr[numKey - 1] = val;
        } else {
          isArray = false;
        }
      } else {
        isArray = false;
        const keyStr = lua.lua_tojsstring(L, -2);
        obj[keyStr] = val;
      }
      count++;
      lua.lua_pop(L, 1);
    }

    if (count > 0 && isArray && arr.length === count && !arr.includes(undefined)) {
      return arr;
    }
    return obj;
  }
  return null;
}

function parseCsvRows(input: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function parseCsv(input: string, opts: Record<string, unknown> = {}): unknown[] {
  const delimiter = typeof opts.delimiter === 'string' && opts.delimiter ? opts.delimiter[0] : ',';
  const useHeader = opts.header !== false;
  const rawRows = parseCsvRows(input, delimiter);
  if (rawRows.length === 0) return [];
  if (!useHeader) return rawRows;

  const headers = rawRows[0].map((h, i) => h.trim() || `col_${i + 1}`);
  return rawRows.slice(1).map(vals => {
    const rec: Record<string, unknown> = {};
    headers.forEach((col, i) => {
      rec[col] = vals[i] ?? '';
    });
    return rec;
  });
}

function escapeCsvCell(val: unknown, delimiter: string): string {
  const str = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes('"') || str.includes(delimiter) || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function stringifyCsv(rowsInput: unknown, opts: Record<string, unknown> = {}): string {
  const delimiter = typeof opts.delimiter === 'string' && opts.delimiter ? opts.delimiter[0] : ',';
  const rows = Array.isArray(rowsInput)
    ? rowsInput
    : rowsInput && typeof rowsInput === 'object'
      ? Object.values(rowsInput as Record<string, unknown>)
      : [];
  if (rows.length === 0) return '';

  if (Array.isArray(rows[0])) {
    return (rows as unknown[][])
      .map(r => r.map(c => escapeCsvCell(c, delimiter)).join(delimiter))
      .join('\n');
  }

  const objRows = rows.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'));
  if (objRows.length === 0) return '';

  const explicitCols = Array.isArray(opts.columns) ? opts.columns.map(String) : null;
  const cols =
    explicitCols ??
    Array.from(
      objRows.reduce((set, row) => {
        for (const key of Object.keys(row)) set.add(key);
        return set;
      }, new Set<string>())
    );

  const lines = [cols.map(c => escapeCsvCell(c, delimiter)).join(delimiter)];
  for (const row of objRows) {
    lines.push(cols.map(c => escapeCsvCell(row[c], delimiter)).join(delimiter));
  }
  return lines.join('\n');
}

function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
    const parts = path.split('.');
    let cur: unknown = vars;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return '';
      }
    }
    if (cur === null || cur === undefined) return '';
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  });
}

async function performHttp(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  rawBody: unknown,
  headersObj: Record<string, unknown> | null,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<{ status_code: number; ok: boolean; headers: Record<string, string>; body: string; json: unknown }> {
  const headers: Record<string, string> = { 'User-Agent': 'Poseidon/2.0' };
  let bodyStr: string | undefined;

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    if (rawBody !== null && rawBody !== undefined) {
      if (typeof rawBody === 'string') {
        bodyStr = rawBody;
      } else {
        bodyStr = JSON.stringify(rawBody);
      }
      headers['Content-Type'] = 'application/json';
    } else {
      bodyStr = '';
    }
  }

  if (headersObj) {
    for (const [k, v] of Object.entries(headersObj)) {
      headers[k] = String(v ?? '');
    }
  }

  const effectiveSignal = timeoutMs
    ? signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    : signal;

  const resp = await fetch(url, {
    method,
    headers,
    body: bodyStr,
    signal: effectiveSignal
  });
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  const text = await resp.text();
  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    parsedJson = null;
  }

  return {
    status_code: resp.status,
    ok: resp.ok,
    headers: respHeaders,
    body: text,
    json: parsedJson
  };
}

async function performHttpRequest(
  opts: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ status_code: number; ok: boolean; headers: Record<string, string>; body: string; json: unknown }> {
  const methodRaw = String(opts.method ?? 'GET').toUpperCase();
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
  const method = allowedMethods.includes(methodRaw as (typeof allowedMethods)[number])
    ? (methodRaw as (typeof allowedMethods)[number])
    : 'GET';

  let url = String(opts.url ?? '');
  if (!url) throw new Error('http.request requires a url');

  if (opts.query && typeof opts.query === 'object') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query as Record<string, unknown>)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }
  }

  const bodyInput = opts.json !== undefined ? opts.json : opts.body ?? null;
  const headersObj = (opts.headers as Record<string, unknown>) ?? null;
  const timeoutMs = typeof opts.timeout_ms === 'number' ? opts.timeout_ms : undefined;
  return performHttp(method, url, bodyInput, headersObj, signal, timeoutMs);
}

export async function runLuaScript(
  scriptSource: string,
  context: Record<string, unknown>,
  options: LuaExecutionOptions
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  try {
    const sandboxBootstrap = `
      io = nil
      os = nil
      package = nil
      loadfile = nil
      dofile = nil
    `;
    lauxlib.luaL_dostring(L, to_luastring(sandboxBootstrap));

    lua.lua_pushjsfunction(L, (state: unknown) => {
      const argc = lua.lua_gettop(state);
      const op = argc >= 1 ? lua.lua_tojsstring(state, 1) : '';
      const args: unknown[] = [];
      for (let i = 2; i <= argc; i++) {
        args.push(readLuaValue(state, i));
      }

      try {
        switch (op) {
          // -------- flow --------
          case 'flow.get': {
            pushJsValue(state, options.sharedState.get(String(args[0] ?? '')) ?? null);
            return 1;
          }
          case 'flow.set': {
            options.sharedState.set(String(args[0] ?? ''), args[1] ?? null);
            return 0;
          }
          case 'flow.delete': {
            pushJsValue(state, options.sharedState.delete(String(args[0] ?? '')));
            return 1;
          }
          case 'flow.get_all': {
            const snapshot: Record<string, unknown> = {};
            for (const [k, v] of options.sharedState.entries()) snapshot[k] = v;
            pushJsValue(state, snapshot);
            return 1;
          }
          case 'flow.log': {
            options.log(String(args[0] ?? ''));
            return 0;
          }
          case 'flow.emit': {
            const evtName = String(args[0] ?? 'custom_event');
            const payload = args[1] ?? null;
            options.emitEvent?.(evtName, payload);
            options.log(`[event:${evtName}] ${JSON.stringify(payload)}`);
            return 0;
          }
          case 'flow.now': {
            pushJsValue(state, new Date().toISOString());
            return 1;
          }
          case 'flow.unix_ms': {
            pushJsValue(state, Date.now());
            return 1;
          }
          case 'flow.assert': {
            if (!args[0]) {
              throw new Error(String(args[1] ?? 'Assertion failed'));
            }
            return 0;
          }
          case 'flow.env': {
            pushJsValue(state, { mode: 'website', runtime: 'fengari-lua', version: '2.0.0' });
            return 1;
          }

          // -------- json --------
          case 'json.encode': {
            pushJsValue(state, JSON.stringify(args[0] ?? null));
            return 1;
          }
          case 'json.decode': {
            pushJsValue(state, JSON.parse(String(args[0] ?? 'null')));
            return 1;
          }

          // -------- fs --------
          case 'fs.read': {
            pushJsValue(state, options.store.fsRead(String(args[0] ?? '')));
            return 1;
          }
          case 'fs.write': {
            options.store.fsWrite(String(args[0] ?? ''), String(args[1] ?? ''));
            return 0;
          }
          case 'fs.append': {
            const filePath = String(args[0] ?? '');
            const existing = options.store.fsRead(filePath) ?? '';
            options.store.fsWrite(filePath, existing + String(args[1] ?? ''));
            return 0;
          }
          case 'fs.delete': {
            pushJsValue(state, options.store.fsDelete(String(args[0] ?? '')));
            return 1;
          }
          case 'fs.exists': {
            pushJsValue(state, options.store.fsExists(String(args[0] ?? '')));
            return 1;
          }
          case 'fs.list': {
            pushJsValue(state, options.store.fsList());
            return 1;
          }
          case 'fs.read_json': {
            const raw = options.store.fsRead(String(args[0] ?? ''));
            pushJsValue(state, raw !== null ? JSON.parse(raw) : null);
            return 1;
          }
          case 'fs.write_json': {
            options.store.fsWrite(String(args[0] ?? ''), JSON.stringify(args[1] ?? null, null, 2));
            return 0;
          }
          case 'fs.stat': {
            const p = String(args[0] ?? '');
            const content = options.store.fsRead(p);
            pushJsValue(
              state,
              content === null
                ? { exists: false, size: 0 }
                : { exists: true, size: Buffer.byteLength(content, 'utf8') }
            );
            return 1;
          }

          // -------- kv --------
          case 'kv.get': {
            pushJsValue(state, options.store.kvGet(String(args[0] ?? '')));
            return 1;
          }
          case 'kv.set': {
            const ttl = typeof args[2] === 'number' ? args[2] : undefined;
            options.store.kvSet(String(args[0] ?? ''), args[1] ?? null, ttl);
            pushJsValue(state, true);
            return 1;
          }
          case 'kv.delete': {
            pushJsValue(state, options.store.kvDelete(String(args[0] ?? '')));
            return 1;
          }
          case 'kv.list': {
            const prefix = args[0] !== undefined && args[0] !== null ? String(args[0]) : undefined;
            pushJsValue(state, options.store.kvList(prefix));
            return 1;
          }

          // -------- csv --------
          case 'csv.parse': {
            pushJsValue(state, parseCsv(String(args[0] ?? ''), (args[1] as Record<string, unknown>) ?? {}));
            return 1;
          }
          case 'csv.stringify': {
            pushJsValue(state, stringifyCsv(args[0], (args[1] as Record<string, unknown>) ?? {}));
            return 1;
          }

          // -------- text --------
          case 'text.template': {
            pushJsValue(state, renderTemplate(String(args[0] ?? ''), (args[1] as Record<string, unknown>) ?? {}));
            return 1;
          }
          case 'text.trim': {
            pushJsValue(state, String(args[0] ?? '').trim());
            return 1;
          }
          case 'text.split': {
            const s = String(args[0] ?? '');
            const sep = String(args[1] ?? ',');
            pushJsValue(state, s ? s.split(sep) : []);
            return 1;
          }
          case 'text.replace': {
            pushJsValue(state, String(args[0] ?? '').split(String(args[1] ?? '')).join(String(args[2] ?? '')));
            return 1;
          }
          case 'text.contains': {
            pushJsValue(state, String(args[0] ?? '').includes(String(args[1] ?? '')));
            return 1;
          }
          case 'text.slugify': {
            const slug = String(args[0] ?? '')
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
            pushJsValue(state, slug);
            return 1;
          }
          case 'text.regex_match': {
            const str = String(args[0] ?? '');
            const pattern = String(args[1] ?? '');
            const flags = String(args[2] ?? '');
            const m = str.match(new RegExp(pattern, flags));
            pushJsValue(state, m ? Array.from(m) : null);
            return 1;
          }
          case 'text.regex_replace': {
            const str = String(args[0] ?? '');
            const pattern = String(args[1] ?? '');
            const replacement = String(args[2] ?? '');
            const flags = String(args[3] ?? 'g');
            pushJsValue(state, str.replace(new RegExp(pattern, flags), replacement));
            return 1;
          }

          // -------- encoding --------
          case 'encoding.base64_encode': {
            pushJsValue(state, Buffer.from(String(args[0] ?? ''), 'utf8').toString('base64'));
            return 1;
          }
          case 'encoding.base64_decode': {
            pushJsValue(state, Buffer.from(String(args[0] ?? ''), 'base64').toString('utf8'));
            return 1;
          }
          case 'encoding.url_encode': {
            pushJsValue(state, encodeURIComponent(String(args[0] ?? '')));
            return 1;
          }
          case 'encoding.url_decode': {
            pushJsValue(state, decodeURIComponent(String(args[0] ?? '')));
            return 1;
          }
          case 'encoding.hex_encode': {
            pushJsValue(state, Buffer.from(String(args[0] ?? ''), 'utf8').toString('hex'));
            return 1;
          }
          case 'encoding.hex_decode': {
            pushJsValue(state, Buffer.from(String(args[0] ?? ''), 'hex').toString('utf8'));
            return 1;
          }

          // -------- crypto --------
          case 'crypto.sha256': {
            const digest = crypto.createHash('sha256').update(String(args[0] ?? ''), 'utf8').digest('base64');
            pushJsValue(state, digest);
            return 1;
          }
          case 'crypto.sha512': {
            const digest = crypto.createHash('sha512').update(String(args[0] ?? ''), 'utf8').digest('hex');
            pushJsValue(state, digest);
            return 1;
          }
          case 'crypto.md5': {
            const digest = crypto.createHash('md5').update(String(args[0] ?? ''), 'utf8').digest('hex');
            pushJsValue(state, digest);
            return 1;
          }
          case 'crypto.hmac_sha256': {
            const mac = crypto
              .createHmac('sha256', String(args[1] ?? ''))
              .update(String(args[0] ?? ''), 'utf8')
              .digest('hex');
            pushJsValue(state, mac);
            return 1;
          }
          case 'crypto.hmac_sha512': {
            const mac = crypto
              .createHmac('sha512', String(args[1] ?? ''))
              .update(String(args[0] ?? ''), 'utf8')
              .digest('hex');
            pushJsValue(state, mac);
            return 1;
          }
          case 'crypto.uuid': {
            pushJsValue(state, crypto.randomUUID());
            return 1;
          }
          case 'crypto.random_bytes': {
            const count = Math.round(Number(args[0] ?? 16));
            if (count < 0 || count > 1024 * 1024) throw new Error('Invalid byte count');
            pushJsValue(state, crypto.randomBytes(count).toString('base64'));
            return 1;
          }
          case 'crypto.random_int': {
            const min = Math.floor(Number(args[0] ?? 0));
            const max = Math.floor(Number(args[1] ?? 100));
            if (max <= min) throw new Error('random_int requires max > min');
            pushJsValue(state, crypto.randomInt(min, max));
            return 1;
          }
          case 'crypto.aes_encrypt': {
            const pt = Buffer.from(String(args[0] ?? ''), 'base64');
            const key = Buffer.from(String(args[1] ?? ''), 'base64');
            pushJsValue(state, AesGcmEncryption.encrypt(pt, key).toString('base64'));
            return 1;
          }
          case 'crypto.aes_decrypt': {
            const ct = Buffer.from(String(args[0] ?? ''), 'base64');
            const key = Buffer.from(String(args[1] ?? ''), 'base64');
            pushJsValue(state, AesGcmEncryption.decrypt(ct, key).toString('base64'));
            return 1;
          }
          case 'crypto.constant_time_equals': {
            const a = Buffer.from(String(args[0] ?? ''), 'utf8');
            const b = Buffer.from(String(args[1] ?? ''), 'utf8');
            if (a.length !== b.length) {
              pushJsValue(state, false);
              return 1;
            }
            pushJsValue(state, crypto.timingSafeEqual(a, b));
            return 1;
          }

          // -------- mail --------
          case 'mail.send': {
            const msg = (args[0] as Record<string, unknown>) ?? {};
            options.log(
              `[mail] to=${String(msg.to ?? '')} subject=${String(msg.subject ?? '')} body=${JSON.stringify(String(msg.body ?? ''))}`
            );
            pushJsValue(state, true);
            return 1;
          }

          // -------- db --------
          case 'db.insert': {
            const tableName = String(args[0] ?? '');
            const rowObj = (args[1] as Record<string, unknown>) ?? {};
            options.store.insertCustomRow(tableName, rowObj);
            pushJsValue(state, 1);
            return 1;
          }
          case 'db.find': {
            const tableName = String(args[0] ?? '');
            const whereObj = (args[1] as Record<string, unknown>) ?? undefined;
            pushJsValue(state, options.store.findCustomRows(tableName, whereObj));
            return 1;
          }
          case 'db.update': {
            const tableName = String(args[0] ?? '');
            const idOrWhere = args[1] as number | string | Record<string, unknown>;
            const patchObj = (args[2] as Record<string, unknown>) ?? {};
            pushJsValue(state, options.store.updateCustomRows(tableName, idOrWhere, patchObj));
            return 1;
          }
          case 'db.delete': {
            const tableName = String(args[0] ?? '');
            const idOrWhere = args[1] as number | string | Record<string, unknown>;
            pushJsValue(state, options.store.deleteCustomRows(tableName, idOrWhere));
            return 1;
          }
          case 'db.count': {
            pushJsValue(state, options.store.countTableRows(String(args[0] ?? '')));
            return 1;
          }
          case 'db.tables': {
            pushJsValue(state, options.store.listTables().map(t => t.name));
            return 1;
          }

          // -------- ai metadata --------
          case 'ai.providers': {
            const list = options.store.aiProviders.listPublic().map(p => ({
              id: p.id,
              name: p.name,
              api_format: p.apiFormat,
              default_model: p.defaultModel,
              models: p.models,
              enabled: p.enabled,
              is_default: p.isDefault,
              is_custom: p.isCustom,
              has_api_key: p.hasApiKey
            }));
            pushJsValue(state, list);
            return 1;
          }
          case 'ai.models': {
            const pid = args[0] !== undefined && args[0] !== null ? String(args[0]) : undefined;
            if (pid) {
              const p = options.store.aiProviders.getPublic(pid);
              pushJsValue(state, p ? p.models : []);
            } else {
              const all: Record<string, string[]> = {};
              for (const p of options.store.aiProviders.listPublic()) {
                all[p.id] = p.models;
              }
              pushJsValue(state, all);
            }
            return 1;
          }

          // -------- connections & secrets --------
          case 'connections.get': {
            const nameOrId = String(args[0] ?? '').trim();
            pushJsValue(state, nameOrId ? options.store.connections.getResolved(nameOrId) : null);
            return 1;
          }
          case 'connections.token': {
            const nameOrId = String(args[0] ?? '').trim();
            const conn = nameOrId ? options.store.connections.getResolved(nameOrId) : null;
            pushJsValue(state, conn ? conn.token ?? conn.value ?? null : null);
            return 1;
          }
          case 'connections.url': {
            const nameOrId = String(args[0] ?? '').trim();
            const conn = nameOrId ? options.store.connections.getResolved(nameOrId) : null;
            pushJsValue(state, conn && conn.url ? conn.url : null);
            return 1;
          }
          case 'connections.secret': {
            const nameOrId = String(args[0] ?? '').trim();
            const conn = nameOrId ? options.store.connections.getResolved(nameOrId) : null;
            pushJsValue(state, conn ? conn.webhook_secret ?? conn.secret ?? null : null);
            return 1;
          }
          case 'connections.find': {
            const category = String(args[0] ?? '').trim();
            pushJsValue(state, category ? options.store.connections.findByCategory(category) : null);
            return 1;
          }
          case 'connections.list': {
            const category = args[0] !== undefined && args[0] !== null ? String(args[0]) : undefined;
            pushJsValue(state, options.store.connections.listMetadataForLua(category));
            return 1;
          }
          case 'secrets.get': {
            const name = String(args[0] ?? '').trim();
            const allSecrets = options.store.getDecryptedSecretsMap();
            pushJsValue(state, name && allSecrets[name] ? allSecrets[name] : null);
            return 1;
          }

          default:
            throw new Error(`Unknown sync operation: ${op}`);
        }
      } catch (err) {
        lua.lua_pushstring(state, to_luastring((err as Error).message));
        return lua.lua_error(state);
      }
    });
    lua.lua_setglobal(L, to_luastring('__poseidon_sync'));

    const libsBootstrap = `
      local function __poseidon_async(op, ...)
        local ok, res = coroutine.yield("__poseidon_async", op, ...)
        if not ok then
          error(tostring(res), 2)
        end
        return res
      end

      function print(...)
        local parts = {}
        local n = select("#", ...)
        for i = 1, n do
          parts[i] = tostring(select(i, ...))
        end
        __poseidon_sync("flow.log", table.concat(parts, "\\t"))
      end

      flow = {
        get = function(k) return __poseidon_sync("flow.get", k) end,
        set = function(k, v) return __poseidon_sync("flow.set", k, v) end,
        delete = function(k) return __poseidon_sync("flow.delete", k) end,
        get_all = function() return __poseidon_sync("flow.get_all") end,
        log = function(msg) return __poseidon_sync("flow.log", msg) end,
        emit = function(event, payload) return __poseidon_sync("flow.emit", event, payload) end,
        now = function() return __poseidon_sync("flow.now") end,
        unix_ms = function() return __poseidon_sync("flow.unix_ms") end,
        assert = function(cond, msg) return __poseidon_sync("flow.assert", cond, msg) end,
        env = function() return __poseidon_sync("flow.env") end,
        sleep = function(ms) return __poseidon_async("flow.sleep", ms) end
      }

      json = {
        encode = function(v) return __poseidon_sync("json.encode", v) end,
        decode = function(s) return __poseidon_sync("json.decode", s) end
      }

      fs = {
        read = function(p) return __poseidon_sync("fs.read", p) end,
        write = function(p, c) return __poseidon_sync("fs.write", p, c) end,
        append = function(p, c) return __poseidon_sync("fs.append", p, c) end,
        delete = function(p) return __poseidon_sync("fs.delete", p) end,
        exists = function(p) return __poseidon_sync("fs.exists", p) end,
        list = function(d) return __poseidon_sync("fs.list", d) end,
        read_json = function(p) return __poseidon_sync("fs.read_json", p) end,
        write_json = function(p, v) return __poseidon_sync("fs.write_json", p, v) end,
        stat = function(p) return __poseidon_sync("fs.stat", p) end
      }

      kv = {
        get = function(k) return __poseidon_sync("kv.get", k) end,
        set = function(k, v, ttl) return __poseidon_sync("kv.set", k, v, ttl) end,
        delete = function(k) return __poseidon_sync("kv.delete", k) end,
        list = function(prefix) return __poseidon_sync("kv.list", prefix) end
      }

      csv = {
        parse = function(s, opts) return __poseidon_sync("csv.parse", s, opts) end,
        stringify = function(rows, opts) return __poseidon_sync("csv.stringify", rows, opts) end
      }

      text = {
        template = function(tpl, vars) return __poseidon_sync("text.template", tpl, vars) end,
        trim = function(s) return __poseidon_sync("text.trim", s) end,
        split = function(s, sep) return __poseidon_sync("text.split", s, sep) end,
        replace = function(s, a, b) return __poseidon_sync("text.replace", s, a, b) end,
        contains = function(s, sub) return __poseidon_sync("text.contains", s, sub) end,
        slugify = function(s) return __poseidon_sync("text.slugify", s) end,
        regex_match = function(s, pat, flags) return __poseidon_sync("text.regex_match", s, pat, flags) end,
        regex_replace = function(s, pat, rep, flags) return __poseidon_sync("text.regex_replace", s, pat, rep, flags) end
      }

      encoding = {
        base64_encode = function(s) return __poseidon_sync("encoding.base64_encode", s) end,
        base64_decode = function(s) return __poseidon_sync("encoding.base64_decode", s) end,
        url_encode = function(s) return __poseidon_sync("encoding.url_encode", s) end,
        url_decode = function(s) return __poseidon_sync("encoding.url_decode", s) end,
        hex_encode = function(s) return __poseidon_sync("encoding.hex_encode", s) end,
        hex_decode = function(s) return __poseidon_sync("encoding.hex_decode", s) end
      }

      crypto = {
        sha256 = function(d) return __poseidon_sync("crypto.sha256", d) end,
        sha512 = function(d) return __poseidon_sync("crypto.sha512", d) end,
        md5 = function(d) return __poseidon_sync("crypto.md5", d) end,
        hmac_sha256 = function(d, k) return __poseidon_sync("crypto.hmac_sha256", d, k) end,
        hmac_sha512 = function(d, k) return __poseidon_sync("crypto.hmac_sha512", d, k) end,
        uuid = function() return __poseidon_sync("crypto.uuid") end,
        random_bytes = function(n) return __poseidon_sync("crypto.random_bytes", n) end,
        random_int = function(min, max) return __poseidon_sync("crypto.random_int", min, max) end,
        aes_encrypt = function(pt, k) return __poseidon_sync("crypto.aes_encrypt", pt, k) end,
        aes_decrypt = function(ct, k) return __poseidon_sync("crypto.aes_decrypt", ct, k) end,
        constant_time_equals = function(a, b) return __poseidon_sync("crypto.constant_time_equals", a, b) end
      }

      mail = {
        send = function(msg) return __poseidon_sync("mail.send", msg) end
      }

      notify = {
        webhook = function(url, payload, headers) return __poseidon_async("notify.webhook", url, payload, headers) end,
        slack = function(url, message, blocks) return __poseidon_async("notify.slack", url, message, blocks) end,
        discord = function(url, content, embeds) return __poseidon_async("notify.discord", url, content, embeds) end
      }

      http = {
        get = function(url, headers) return __poseidon_async("http.get", url, headers) end,
        post = function(url, body, headers) return __poseidon_async("http.post", url, body, headers) end,
        put = function(url, body, headers) return __poseidon_async("http.put", url, body, headers) end,
        patch = function(url, body, headers) return __poseidon_async("http.patch", url, body, headers) end,
        delete = function(url, headers) return __poseidon_async("http.delete", url, headers) end,
        request = function(opts) return __poseidon_async("http.request", opts) end
      }

      db = {
        query = function(sql, ...) return __poseidon_async("db.query", sql, ...) end,
        execute = function(sql, ...) return __poseidon_async("db.execute", sql, ...) end,
        insert = function(tbl, row) return __poseidon_sync("db.insert", tbl, row) end,
        find = function(tbl, where) return __poseidon_sync("db.find", tbl, where) end,
        update = function(tbl, idOrWhere, patch) return __poseidon_sync("db.update", tbl, idOrWhere, patch) end,
        delete = function(tbl, idOrWhere) return __poseidon_sync("db.delete", tbl, idOrWhere) end,
        count = function(tbl) return __poseidon_sync("db.count", tbl) end,
        tables = function() return __poseidon_sync("db.tables") end
      }

      ai = {
        chat = function(req) return __poseidon_async("ai.chat", req) end,
        complete = function(prompt, opts) return __poseidon_async("ai.complete", prompt, opts) end,
        embed = function(input, opts) return __poseidon_async("ai.embed", input, opts) end,
        providers = function() return __poseidon_sync("ai.providers") end,
        models = function(providerId) return __poseidon_sync("ai.models", providerId) end
      }

      connections = {
        get = function(name) return __poseidon_sync("connections.get", name) end,
        token = function(name) return __poseidon_sync("connections.token", name) end,
        url = function(name) return __poseidon_sync("connections.url", name) end,
        secret = function(name) return __poseidon_sync("connections.secret", name) end,
        find = function(category) return __poseidon_sync("connections.find", category) end,
        list = function(category) return __poseidon_sync("connections.list", category) end
      }

      secrets = {
        get = function(name) return __poseidon_sync("secrets.get", name) end
      }
    `;
    const libStatus = lauxlib.luaL_dostring(L, to_luastring(libsBootstrap));
    if (libStatus !== lua.LUA_OK) {
      throw new Error(lua.lua_tojsstring(L, -1));
    }

    const co = lua.lua_newthread(L);
    lua.lua_sethook(
      co,
      (hookState: unknown) => {
        if (options.signal?.aborted) {
          lua.lua_pushstring(hookState, to_luastring('Execution stopped by user'));
          lua.lua_error(hookState);
        }
        if (Date.now() - startedAt > timeoutMs) {
          lua.lua_pushstring(hookState, to_luastring(`Lua script execution exceeded ${timeoutMs / 1000}s`));
          lua.lua_error(hookState);
        }
      },
      lua.LUA_MASKCOUNT,
      10_000
    );

    const runnerSource = `
      return function(chunk, ctx)
        context = ctx
        local mod = chunk()
        if type(mod) == "table" and type(mod.run) == "function" then
          local res = mod.run(ctx)
          if type(res) == "table" then return res end
          return { result = res }
        elseif type(mod) == "table" then
          return mod
        elseif mod ~= nil then
          return { result = mod }
        else
          return { ok = true }
        end
      end
    `;
    const rStatus = lauxlib.luaL_dostring(co, to_luastring(runnerSource));
    if (rStatus !== lua.LUA_OK) {
      throw new Error(lua.lua_tojsstring(co, -1));
    }
    const chunkStatus = lauxlib.luaL_loadstring(co, to_luastring(scriptSource));
    if (chunkStatus !== lua.LUA_OK) {
      throw new Error(`Lua syntax error: ${lua.lua_tojsstring(co, -1)}`);
    }
    pushJsValue(co, context);

    let narg = 2;
    while (true) {
      if (options.signal?.aborted) throw new Error('Execution stopped by user');
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Lua script execution exceeded ${timeoutMs / 1000}s`);
      }

      const status = lua.lua_resume(co, L, narg);
      if (status === lua.LUA_OK) {
        const top = lua.lua_gettop(co);
        if (top === 0) return {};
        const val = readLuaValue(co, -1);
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          return val as Record<string, unknown>;
        }
        return { result: val };
      }

      if (status === lua.LUA_YIELD) {
        const top = lua.lua_gettop(co);
        const marker = top >= 1 ? lua.lua_tojsstring(co, 1) : '';
        if (marker !== '__poseidon_async') throw new Error('Unsupported Lua yield');
        const op = top >= 2 ? lua.lua_tojsstring(co, 2) : '';
        const args: unknown[] = [];
        for (let i = 3; i <= top; i++) args.push(readLuaValue(co, i));
        lua.lua_settop(co, 0);

        try {
          let result: unknown = null;
          if (op === 'http.get') {
            result = await performHttp('GET', String(args[0] ?? ''), null, (args[1] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.post') {
            result = await performHttp('POST', String(args[0] ?? ''), args[1], (args[2] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.put') {
            result = await performHttp('PUT', String(args[0] ?? ''), args[1], (args[2] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.patch') {
            result = await performHttp('PATCH', String(args[0] ?? ''), args[1], (args[2] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.delete') {
            result = await performHttp('DELETE', String(args[0] ?? ''), null, (args[1] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.request') {
            result = await performHttpRequest((args[0] as Record<string, unknown>) ?? {}, options.signal);
          } else if (op === 'ai.chat') {
            result = await options.store.aiProviders.chat((args[0] as AiChatRequest) ?? {}, options.signal);
          } else if (op === 'ai.complete') {
            const prompt = String(args[0] ?? '');
            const opts = (args[1] as Record<string, unknown>) ?? {};
            result = await options.store.aiProviders.chat(
              {
                ...(opts as AiChatRequest),
                prompt
              },
              options.signal
            );
          } else if (op === 'ai.embed') {
            const inputVal = args[0] as string | string[];
            const opts = (args[1] as { provider?: string; model?: string; base_url?: string; api_key?: string }) ?? {};
            result = await options.store.aiProviders.embed(inputVal, opts, options.signal);
          } else if (op === 'notify.webhook') {
            const url = String(args[0] ?? '');
            const payload = args[1] ?? {};
            const headersObj = (args[2] as Record<string, unknown>) ?? null;
            result = await performHttp('POST', url, payload, headersObj, options.signal, 15_000);
          } else if (op === 'notify.slack') {
            const url = String(args[0] ?? '');
            const message = String(args[1] ?? '');
            const blocks = args[2];
            result = await performHttp(
              'POST',
              url,
              blocks ? { text: message, blocks } : { text: message },
              null,
              options.signal,
              15_000
            );
          } else if (op === 'notify.discord') {
            const url = String(args[0] ?? '');
            const content = String(args[1] ?? '');
            const embeds = args[2];
            result = await performHttp(
              'POST',
              url,
              embeds ? { content, embeds } : { content },
              null,
              options.signal,
              15_000
            );
          } else if (op === 'db.query') {
            result = options.store.querySql(String(args[0] ?? ''), args.slice(1));
          } else if (op === 'db.execute') {
            result = options.store.executeSql(String(args[0] ?? ''), args.slice(1));
          } else if (op === 'flow.sleep') {
            const ms = Math.round(Number(args[0] ?? 0));
            if (ms < 0 || ms > 300_000) throw new Error('Sleep ms out of range (0..300000)');
            await new Promise<void>((resolve, reject) => {
              if (options.signal?.aborted) {
                reject(new Error('Execution stopped by user'));
                return;
              }
              const timer = setTimeout(() => {
                options.signal?.removeEventListener('abort', onAbort);
                resolve();
              }, ms);
              const onAbort = () => {
                clearTimeout(timer);
                reject(new Error('Execution stopped by user'));
              };
              options.signal?.addEventListener('abort', onAbort, { once: true });
            });
            result = true;
          } else {
            throw new Error(`Unknown async operation: ${op}`);
          }

          lua.lua_pushboolean(co, true);
          pushJsValue(co, result);
          narg = 2;
        } catch (err) {
          lua.lua_pushboolean(co, false);
          lua.lua_pushstring(co, to_luastring((err as Error).message));
          narg = 2;
        }
        continue;
      }

      const errMsg = lua.lua_gettop(co) > 0 ? lua.lua_tojsstring(co, -1) : `Lua error (${status})`;
      throw new Error(errMsg || `Lua error (${status})`);
    }
  } finally {
    lua.lua_close(L);
  }
}
