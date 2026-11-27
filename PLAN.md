# Poseidon — Build Plan

**Goal:** an n8n-like workflow automation platform where every task is executed by a Lua script, C# is the host, MySQL is the database, and server↔client traffic is cryptographically protected.

Repo: `0xKAYDEN/Poseidon`, branch `arena/fed31d38-poseidon`

---

## 1. Current state (audit of the repo)

| Project | Tech | State |
|---|---|---|
| `Client/PoseidonClient` | WPF, net9.0-windows | Empty shell (`App.xaml`, `MainWindow.xaml`), references Cryptography + Lua |
| `Modules/Poseidon.Cryptography` | net9.0 class lib | Empty (folders `Contracts/`, `Abstruction/`) |
| `Modules/Poseidon.Lua` | net9.0 class lib | `BaseHandler<Client, Script>`, `ScriptManager` (loads `*.lua` from a folder, keyed by numeric filename) |
| `src/Poseidon.Database` | net10.0 + MySqlConnector 3.0.0 | `DatabaseConfigrations`, `ActionModel` only |
| `src/Poseidon.Network` | net10.0 + Anthropic SDK | `OpenAI`, `Anthropic` config models |
| `src/Poseidon` | net10.0 console + Serilog | `Program.cs` instantiates `ScriptManager` on `database/lua` |
| `Poseidon.slnx` | solution | References all six projects |

Issues to fix first: no server host, no Lua runtime binding, no function library, no DB schema/repositories, no encrypted transport, no workflow engine, no client UI.

---

## 2. Target architecture

```
+------------------+      TLS 1.3 + app-layer AES-256-GCM      +------------------+
|  Poseidon.Client | <============================== WSS ====> |  Poseidon.Server |
|  (WPF desktop)   |      JSON over WebSocket, encrypted       |  (ASP.NET Core)  |
+------------------+                                           +------------------+
                                                              |  MySQL (Poseidon.Database)
                                                              +------------------+
```

### Layers

1. **Poseidon.Client (WPF)** — workflow canvas (nodes + edges), node palette, per-node Lua script editor, property inspector, execute/stop, live step logs, login. Connects to the server over `ClientWebSocket`; every frame is encrypted with a negotiated AES-256-GCM session key.
2. **Poseidon.Server (`src/Poseidon`)** — ASP.NET Core host (Kestrel). REST API for workflow CRUD + executions; WebSocket endpoint for the client; Lua runtime; workflow engine; auth (JWT).
3. **Modules/Poseidon.Lua** — NLua-based `LuaEngine`, `IFunctionRegistry`, built-in function libs (`db`, `http`, `fs`, `crypto`, `flow`, `mail`, `ai`), sandboxing (fresh Lua state per node execution, execution timeout, disabled dangerous `io`/`os`).
4. **Modules/Poseidon.Cryptography** — AES-256-GCM envelope encryption, X25519 ECDH session-key negotiation, HKDF derivation, PBKDF2 password hashing, credential vault (AES-256-GCM at rest in MySQL), manual HS256 JWT.
5. **src/Poseidon.Database** — MySqlConnector repository layer + schema (`workflows`, `workflow_nodes`, `workflow_edges`, `executions`, `execution_steps`, `credentials`, `scripts`, `audit_log`).
6. **src/Poseidon.Network** — reusable WebSocket/secure-channel abstractions shared by server and client; OpenAI/Anthropic client models used by the `ai` Lua lib.

### How one task runs (the n8n part)

1. User draws a workflow in the client: nodes (`HTTP Request`, `MySQL Query`, `Code/Lua`, `If`, `Wait`, `AI…`) connected by edges. Saved to MySQL as JSON definitions.
2. Execution is triggered manually, on a schedule, or via webhook.
3. The engine loads the workflow graph, topologically sorts nodes, then runs each node's Lua script with a context: `{ inputs, node, flow, secrets }` plus global libs (`db.query`, `http.get`, …).
4. The script returns an output table. The engine writes an `execution_steps` row, routes the output along outgoing edges to the next nodes (`IdNext` / `IdNextFail` branching from the existing `ActionModel` idea), and continues until terminal nodes.
5. Client receives live step events over the encrypted WebSocket and shows logs in real time.

---

## 3. Data model (MySQL)

`schema.sql` (see file) contains the full DDL. Key tables:

- `workflows(id, name, definition_json, created_at, updated_at, is_active)`
- `workflow_nodes(id, workflow_id, type, name, config_json, lua_script_id, position_x, position_y)`
- `workflow_edges(id, workflow_id, source_node_id, target_node_id, condition, condition_lua)`
- `executions(id, workflow_id, status, trigger_type, input_json, output_json, error, started_at, finished_at)`
- `execution_steps(id, execution_id, node_id, status, input_json, output_json, error, duration_ms, started_at, finished_at)`
- `credentials(id, name, type, encrypted_json, created_at)` — encrypted at rest
- `scripts(id, name, content, version, created_at)` — reusable Lua function scripts

The existing `ActionModel` maps naturally to `workflow_nodes` (`IdNext`/`IdNextFail` = success/fail edge routing).

---

## 4. Cryptography design (server ↔ client)

1. **Transport:** TLS 1.3 (Kestrel with a dev cert; Let's Encrypt / reverse proxy in prod). Never send raw JSON over plaintext WS.
2. **Session keys:** after the WebSocket opens, server sends its ephemeral X25519 public key; client generates its own X25519 pair, performs ECDH, derives a 256-bit AES-GCM key via HKDF-SHA256, and sends its public key back. All subsequent application frames are encrypted/authenticated with AES-256-GCM: envelope `{nonce, body, tag}` (all base64).
3. **Authentication:** first client frame carries a JWT (HS256, issued by `/api/auth/login`); server validates it on every message.
4. **At rest:** `credentials.encrypted_json` is AES-256-GCM encrypted under a master key from `POSEIDON_MASTER_KEY` env var; passwords hashed with PBKDF2-HMAC-SHA256.

Why both TLS and app-layer encryption: defense in depth — TLS protects the tunnel, app-layer encryption protects payloads if TLS is terminated at a proxy, and it gives end-to-end integrity for control messages (start/stop execution).

---

## 5. Lua function library (every task is a Lua script)

Scripts use the module pattern: a chunk returns `{ run = function(context) ... end }`. `context` exposes `inputs`, `node`, `flow`, `secrets`.

Global libs (registered in every Lua state):

| Lib | Functions |
|---|---|
| `http` | `http.get(url, headers?)`, `http.post(url, body, headers?)` → `{status_code, headers, body}` |
| `db` | `db.query(sql, params...)`, `db.execute(sql, params...)` → rows |
| `fs` | `fs.read(path)`, `fs.write(path, content)`, `fs.exists(path)` (sandboxed directory) |
| `crypto` | `crypto.aes_encrypt(plaintext_b64, key_b64)`, `crypto.aes_decrypt(...)`, `crypto.sha256(data)`, `crypto.random_bytes(n)` |
| `flow` | `flow.get(key)`, `flow.set(key, value)`, `flow.sleep(ms)`, `flow.log(msg)` |
| `mail` | `mail.send({to, subject, body})` |
| `ai` | `ai.chat({model, messages})` → completion (wraps OpenAI/Anthropic clients in `Poseidon.Network`) |

Example script (`scripts/examples/http_get.lua`):

```lua
return {
  run = function(context)
    local response = http.get("https://api.example.com/items")
    if response.status_code ~= 200 then
      error("HTTP " .. response.status_code)
    end
    flow.log("fetched " .. #response.body .. " bytes")
    return { items = response.body }
  end
}
```

---

## 6. Milestones

| Milestone | Deliverable |
|---|---|
| **M1 — Foundation** | Repo tfm alignment, `Poseidon.Cryptography` (AES-GCM, X25519, PBKDF2, JWT, vault), `Poseidon.Database` schema + MySqlConnector repo |
| **M2 — Lua runtime** | `LuaEngine` (NLua), function registry, built-in libs (`db`, `http`, `fs`, `crypto`, `flow`), sample scripts |
| **M3 — Workflow engine** | Load graph from MySQL, execute nodes with per-script Lua contexts, edge routing (`IdNext`/`IdNextFail`), step logging |
| **M4 — Server** | ASP.NET Core API + encrypted WebSocket endpoint, JWT auth, execution start/status |
| **M5 — Client** | WPF canvas, node editor, live encrypted WebSocket logs |
| **M6 — Integrations** | `mail` and `ai` libs, credential manager, schedules/webhooks |

---

## 7. How to build and run (after M1–M4 code is in place)

Requires .NET 9 SDK + MySQL (or a MySQL-compatible server, e.g. MariaDB).

```bash
# 1. Create the database
mysql -u root -p < src/Poseidon.Database/Schema/schema.sql

# 2. Configure (environment variables)
export POSEIDON_DB_HOST=localhost
export POSEIDON_DB_PORT=3306
export POSEIDON_DB_USER=poseidon
export POSEIDON_DB_PASSWORD=changeme
export POSEIDON_DB_SCHEMA=poseidon
export POSEIDON_MASTER_KEY=<base64 32-byte key>
export POSEIDON_JWT_KEY=<base64 32-byte signing key>
export ASPNETCORE_URLS=http://localhost:7071   # use https:// in prod

# 3. Restore & build the server
cd src/Poseidon
dotnet restore
dotnet build

# 4. Run the server
dotnet run

# 5. Run the client (separate machine/session)
cd ../../Client/PoseidonClient
dotnet restore
dotnet build
dotnet run
```

Note: `dotnet`, `lua`, and `mysql` are not installed in this sandbox, so compilation must be done on your machine. The source below is written against .NET 9/10 and the `NLua` package (Lua 5.1 binding for .NET).

---

## 8. Files added in this step

- `PLAN.md` — this plan
- `src/Poseidon.Database/Schema/schema.sql` — MySQL schema
- `src/Poseidon.Database/Core/PoseidonDb.cs` — MySqlConnector repository layer
- `src/Poseidon.Database/Models/Workflow.cs`, `Execution.cs` — workflow models
- `Modules/Poseidon.Cryptography/Crypto/AesGcmEncryption.cs`
- `Modules/Poseidon.Cryptography/Crypto/EcdhKeyAgreement.cs`
- `Modules/Poseidon.Cryptography/Crypto/CredentialVault.cs`
- `Modules/Poseidon.Cryptography/Crypto/PasswordHasher.cs`
- `Modules/Poseidon.Cryptography/Crypto/JwtService.cs`
- `Modules/Poseidon.Cryptography/Crypto/SecureChannel.cs`
- `Modules/Poseidon.Lua/Core/LuaEngine.cs`
- `Modules/Poseidon.Lua/Lib/LuaLib.cs`
- `Modules/Poseidon.Lua/Lib/HttpLib.cs`
- `Modules/Poseidon.Lua/Lib/DbLib.cs`
- `Modules/Poseidon.Lua/Lib/FsLib.cs`
- `Modules/Poseidon.Lua/Lib/CryptoLib.cs`
- `Modules/Poseidon.Lua/Lib/FlowLib.cs`
- `Modules/Poseidon.Lua/Lib/MailLib.cs`
- `Modules/Poseidon.Lua/Lib/AiLib.cs`
- `src/Poseidon/Program.cs` — ASP.NET Core server host
- `src/Poseidon/Services/WorkflowEngine.cs`
- `src/Poseidon/Services/SessionManager.cs`
- `Client/PoseidonClient/Network/SecureClientChannel.cs`
- `scripts/examples/http_get.lua`, `scripts/examples/db_query.lua`, `scripts/examples/ai_summary.lua`
- csproj updates: `src/Poseidon` (ASP.NET Core + NLua), `Modules/Poseidon.Lua` (NLua)
