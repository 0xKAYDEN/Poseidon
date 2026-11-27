import crypto from 'node:crypto';
import fengari from 'fengari';
import { AesGcmEncryption } from './crypto.js';
import type { PoseidonStore } from './store.js';

const { lua, lauxlib, lualib, to_luastring } = fengari;

export interface LuaExecutionOptions {
  store: PoseidonStore;
  sharedState: Map<string, unknown>;
  log: (msg: string) => void;
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

async function callAiChat(request: Record<string, unknown>): Promise<{ content: string; model: string }> {
  const model = typeof request.model === 'string' && request.model ? request.model : 'gpt-4o-mini';
  const rawMessages = request.messages;
  const messages: Array<{ role: string; content: string }> = [];

  if (Array.isArray(rawMessages)) {
    for (const m of rawMessages) {
      if (m && typeof m === 'object') {
        const msg = m as Record<string, unknown>;
        messages.push({ role: String(msg.role ?? 'user'), content: String(msg.content ?? '') });
      }
    }
  } else if (rawMessages && typeof rawMessages === 'object') {
    for (const m of Object.values(rawMessages as Record<string, unknown>)) {
      if (m && typeof m === 'object') {
        const msg = m as Record<string, unknown>;
        messages.push({ role: String(msg.role ?? 'user'), content: String(msg.content ?? '') });
      }
    }
  }

  const apiKey = process.env.POSEIDON_AI_API_KEY ?? '';
  const apiUrl = process.env.POSEIDON_AI_URL || 'https://api.openai.com/v1/chat/completions';

  if (!apiKey) {
    const promptSummary = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    return {
      model,
      content: `[stub] I would have answered:\n${promptSummary}`
    };
  }

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 500 })
    });
    const text = await resp.text();
    if (!resp.ok) {
      return { model, content: `[ai error] HTTP ${resp.status} ${text}` };
    }
    const parsed = JSON.parse(text) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    return {
      model: parsed.model ?? model,
      content: parsed.choices?.[0]?.message?.content ?? ''
    };
  } catch (err) {
    return { model, content: `[ai exception] ${(err as Error).message}` };
  }
}

async function performHttp(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body: string | null,
  headersObj: Record<string, unknown> | null,
  signal?: AbortSignal
): Promise<{ status_code: number; headers: Record<string, string>; body: string }> {
  const headers: Record<string, string> = { 'User-Agent': 'Poseidon/1.0' };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (headersObj) {
    for (const [k, v] of Object.entries(headersObj)) {
      headers[k] = String(v ?? '');
    }
  }
  const resp = await fetch(url, {
    method,
    headers,
    body: method === 'POST' || method === 'PUT' ? body ?? '' : undefined,
    signal
  });
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  return {
    status_code: resp.status,
    headers: respHeaders,
    body: await resp.text()
  };
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
          case 'flow.get': {
            pushJsValue(state, options.sharedState.get(String(args[0] ?? '')) ?? null);
            return 1;
          }
          case 'flow.set': {
            options.sharedState.set(String(args[0] ?? ''), args[1] ?? null);
            return 0;
          }
          case 'flow.log': {
            options.log(String(args[0] ?? ''));
            return 0;
          }
          case 'flow.now': {
            pushJsValue(state, new Date().toISOString());
            return 1;
          }
          case 'json.encode': {
            pushJsValue(state, JSON.stringify(args[0] ?? null));
            return 1;
          }
          case 'json.decode': {
            pushJsValue(state, JSON.parse(String(args[0] ?? 'null')));
            return 1;
          }
          case 'fs.read': {
            pushJsValue(state, options.store.fsRead(String(args[0] ?? '')));
            return 1;
          }
          case 'fs.write': {
            options.store.fsWrite(String(args[0] ?? ''), String(args[1] ?? ''));
            return 0;
          }
          case 'fs.exists': {
            pushJsValue(state, options.store.fsExists(String(args[0] ?? '')));
            return 1;
          }
          case 'fs.list': {
            pushJsValue(state, options.store.fsList());
            return 1;
          }
          case 'crypto.sha256': {
            const digest = crypto.createHash('sha256').update(String(args[0] ?? ''), 'utf8').digest('base64');
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
          case 'mail.send': {
            const msg = (args[0] as Record<string, unknown>) ?? {};
            options.log(
              `[mail] to=${String(msg.to ?? '')} subject=${String(msg.subject ?? '')} body=${JSON.stringify(String(msg.body ?? ''))}`
            );
            pushJsValue(state, true);
            return 1;
          }
          case 'db.insert': {
            const tableName = String(args[0] ?? '');
            const rowObj = (args[1] as Record<string, unknown>) ?? {};
            options.store.insertCustomRow(tableName, rowObj);
            pushJsValue(state, 1);
            return 1;
          }
          case 'db.tables': {
            pushJsValue(state, options.store.listTables().map(t => t.name));
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
        log = function(msg) return __poseidon_sync("flow.log", msg) end,
        now = function() return __poseidon_sync("flow.now") end,
        sleep = function(ms) return __poseidon_async("flow.sleep", ms) end
      }

      json = {
        encode = function(v) return __poseidon_sync("json.encode", v) end,
        decode = function(s) return __poseidon_sync("json.decode", s) end
      }

      fs = {
        read = function(p) return __poseidon_sync("fs.read", p) end,
        write = function(p, c) return __poseidon_sync("fs.write", p, c) end,
        exists = function(p) return __poseidon_sync("fs.exists", p) end,
        list = function(d) return __poseidon_sync("fs.list", d) end
      }

      crypto = {
        sha256 = function(d) return __poseidon_sync("crypto.sha256", d) end,
        hmac_sha256 = function(d, k) return __poseidon_sync("crypto.hmac_sha256", d, k) end,
        uuid = function() return __poseidon_sync("crypto.uuid") end,
        random_bytes = function(n) return __poseidon_sync("crypto.random_bytes", n) end,
        aes_encrypt = function(pt, k) return __poseidon_sync("crypto.aes_encrypt", pt, k) end,
        aes_decrypt = function(ct, k) return __poseidon_sync("crypto.aes_decrypt", ct, k) end
      }

      mail = {
        send = function(msg) return __poseidon_sync("mail.send", msg) end
      }

      http = {
        get = function(url, headers) return __poseidon_async("http.get", url, headers) end,
        post = function(url, body, headers) return __poseidon_async("http.post", url, body, headers) end,
        put = function(url, body, headers) return __poseidon_async("http.put", url, body, headers) end,
        delete = function(url, headers) return __poseidon_async("http.delete", url, headers) end
      }

      db = {
        query = function(sql, ...) return __poseidon_async("db.query", sql, ...) end,
        execute = function(sql, ...) return __poseidon_async("db.execute", sql, ...) end,
        insert = function(tbl, row) return __poseidon_sync("db.insert", tbl, row) end,
        tables = function() return __poseidon_sync("db.tables") end
      }

      ai = {
        chat = function(req) return __poseidon_async("ai.chat", req) end
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
            result = await performHttp('POST', String(args[0] ?? ''), args[1] != null ? String(args[1]) : null, (args[2] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.put') {
            result = await performHttp('PUT', String(args[0] ?? ''), args[1] != null ? String(args[1]) : null, (args[2] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'http.delete') {
            result = await performHttp('DELETE', String(args[0] ?? ''), null, (args[1] as Record<string, unknown>) ?? null, options.signal);
          } else if (op === 'ai.chat') {
            result = await callAiChat((args[0] as Record<string, unknown>) ?? {});
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
