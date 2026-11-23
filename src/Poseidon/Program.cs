using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using DotNetEnv;
using Microsoft.AspNetCore.Http;
using Poseidon.Cryptography.Crypto;
using Poseidon.Database.Core;
using Poseidon.Database.Core.Configrations;
using Poseidon.Database.Models;
using Poseidon.Lua.Core;
using Poseidon.Lua.Lib;
using Poseidon.Services;

// Load .env file into environment variables (if present)
Env.Load();

var builder = WebApplication.CreateBuilder(args);

// ---------------- configuration from environment ----------------
string dbHost = Environment.GetEnvironmentVariable("POSEIDON_DB_HOST") ?? "localhost";
int dbPort = int.TryParse(Environment.GetEnvironmentVariable("POSEIDON_DB_PORT"), out var p) ? p : 3306;
string dbUser = Environment.GetEnvironmentVariable("POSEIDON_DB_USER") ?? "poseidon";
string dbPassword = Environment.GetEnvironmentVariable("POSEIDON_DB_PASSWORD") ?? "poseidon";
string dbSchema = Environment.GetEnvironmentVariable("POSEIDON_DB_SCHEMA") ?? "poseidon";

byte[] masterKey;
try { masterKey = Convert.FromBase64String(Environment.GetEnvironmentVariable("POSEIDON_MASTER_KEY") ?? string.Empty); }
catch { throw new InvalidOperationException("POSEIDON_MASTER_KEY must be a base64-encoded 32-byte key"); }
if (masterKey.Length != 32) throw new InvalidOperationException("POSEIDON_MASTER_KEY must decode to exactly 32 bytes");

byte[] jwtKey;
try { jwtKey = Convert.FromBase64String(Environment.GetEnvironmentVariable("POSEIDON_JWT_KEY") ?? string.Empty); }
catch { throw new InvalidOperationException("POSEIDON_JWT_KEY must be a base64-encoded 32-byte key"); }
if (jwtKey.Length != 32) throw new InvalidOperationException("POSEIDON_JWT_KEY must decode to exactly 32 bytes");

string adminUser = Environment.GetEnvironmentVariable("POSEIDON_ADMIN_USER") ?? "admin";
string adminPasswordHash = Environment.GetEnvironmentVariable("POSEIDON_ADMIN_PASSWORD_HASH") ?? string.Empty;

builder.Services.AddSingleton(new DatabaseConfigrations
{
    HostAddress = dbHost,
    DatabasePort = dbPort,
    Username = dbUser,
    Password = dbPassword,
    Schema = dbSchema
});
builder.Services.AddSingleton<PoseidonDb>();
builder.Services.AddSingleton<CredentialVault>(new CredentialVault(masterKey));
builder.Services.AddSingleton<JwtService>(new JwtService(jwtKey));
builder.Services.AddSingleton<WorkflowEngine>();
builder.Services.AddSingleton<SessionManager>();
builder.Services.AddCors(options => options.AddPolicy("allow-all", p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();

app.UseCors("allow-all");

// ---------------- simple JWT middleware for /api ----------------
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") &&
        !context.Request.Path.StartsWithSegments("/api/auth/login") &&
        !context.Request.Path.StartsWithSegments("/api/health"))
    {
        string? auth = context.Request.Headers.Authorization.ToString();
        if (auth is null || !auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "missing token" });
            return;
        }
        string token = auth["Bearer ".Length..].Trim();
        var jwtService = app.Services.GetRequiredService<JwtService>();
        if (!jwtService.ValidateToken(token, out var claims))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "invalid token" });
            return;
        }
        context.Items["user"] = claims;
    }
    await next();
});

// ---------------- auth ----------------
app.MapPost("/api/auth/login", async (HttpContext context, JwtService jwtService) =>
{
    var req = await context.Request.ReadFromJsonAsync<LoginRequest>();
    if (req is null || req.Username != adminUser)
    {
        context.Response.StatusCode = 401;
        await context.Response.WriteAsJsonAsync(new { error = "invalid credentials" });
        return;
    }
    if (string.IsNullOrEmpty(adminPasswordHash) ||
        !PasswordHasher.Verify(req.Password ?? string.Empty, adminPasswordHash))
    {
        context.Response.StatusCode = 401;
        await context.Response.WriteAsJsonAsync(new { error = "invalid credentials" });
        return;
    }

    string token = jwtService.CreateToken(
        new Dictionary<string, object> { ["sub"] = req.Username }, TimeSpan.FromHours(8));
    await context.Response.WriteAsJsonAsync(new { token });
});

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "poseidon" }));

// ---------------- workflows ----------------
app.MapGet("/api/workflows", async (PoseidonDb db) =>
    Results.Ok(await db.GetWorkflowsAsync()));

app.MapPost("/api/workflows", async (HttpContext context, PoseidonDb db) =>
{
    var wf = await context.Request.ReadFromJsonAsync<WorkflowDto>();
    if (wf is null) return Results.BadRequest(new { error = "body required" });
    ulong id = await db.CreateWorkflowAsync(new Poseidon.Database.Models.Workflow
    {
        Name = wf.Name,
        Description = wf.Description,
        DefinitionJson = wf.DefinitionJson,
        IsActive = wf.IsActive
    });
    return Results.Created($"/api/workflows/{id}", new { id });
});

app.MapGet("/api/workflows/{id}", async (ulong id, PoseidonDb db) =>
{
    var wf = await db.GetWorkflowAsync(id);
    return wf is null ? Results.NotFound() : Results.Ok(wf);
});

app.MapDelete("/api/workflows/{id}", async (ulong id, PoseidonDb db) =>
    await db.DeleteWorkflowAsync(id) ? Results.NoContent() : Results.NotFound());

// ---------------- executions ----------------
app.MapPost("/api/workflows/{id}/execute", async (ulong id, HttpContext context, PoseidonDb db, WorkflowEngine engine) =>
{
    var req = await context.Request.ReadFromJsonAsync<ExecuteRequest>();
    string? inputJson = req?.InputJson != null ? JsonSerializer.Serialize(req.InputJson) : null;
    ulong executionId = await db.CreateExecutionAsync(id, req?.TriggerType ?? "manual", inputJson);
    _ = Task.Run(async () => await engine.ExecuteAsync(id, executionId, req?.TriggerType ?? "manual"));
    return Results.Accepted($"/api/executions/{executionId}", new { executionId });
});

app.MapGet("/api/executions/{id}", async (ulong id, PoseidonDb db) =>
{
    // minimal: expose via a small query. For MVP return execution id placeholder.
    return Results.Ok(new { id });
});

app.MapGet("/api/executions/{id}/steps", async (ulong id, PoseidonDb db) => Results.Ok(new { id, steps = System.Array.Empty<object>() }));

// ---------------- encrypted websocket (client channel) ----------------
app.MapGet("/ws", async (HttpContext context, SessionManager sessions, PoseidonDb db, WorkflowEngine engine, JwtService jwtService) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }

    using WebSocket webSocket = await context.WebSockets.AcceptWebSocketAsync();
    var channel = new SecureChannel();
    string sessionId = sessions.Add(channel);

    try
    {
        // 1) server hello: send ephemeral public key
        await channel.SendHello(webSocket); // sends { type: "channel_hello", server_key }

        // 2) wait for client ready with its public key + jwt
        string? clientReady = await channel.ReceiveFrameAsync(webSocket);
        if (clientReady is null) return;
        using var doc = JsonDocument.Parse(clientReady);
        byte[] clientKey = Convert.FromBase64String(doc.RootElement.GetProperty("client_key").GetString()!);
        string? jwt = doc.RootElement.TryGetProperty("jwt", out var jt) ? jt.GetString() : null;
        channel.Establish(clientKey);

        if (!string.IsNullOrEmpty(jwt) &&
            !jwtService.ValidateToken(jwt, out _))
        {
            await channel.SendFrameAsync(webSocket, new { type = "error", error = "unauthorized" });
            return;
        }

        await channel.SendFrameAsync(webSocket, new { type = "channel_established" });

        // 3) command loop: every client frame is an AES-256-GCM envelope.
        while (webSocket.State == WebSocketState.Open)
        {
            string? envelope = await channel.ReceiveFrameAsync(webSocket);
            if (envelope is null) break;
            string json = channel.Decrypt(envelope);
            using var cmd = JsonDocument.Parse(json);
            string type = cmd.RootElement.GetProperty("type").GetString() ?? string.Empty;

            if (type == "execute_workflow")
            {
                ulong workflowId = cmd.RootElement.GetProperty("workflow_id").GetUInt64();
                ulong executionId = await db.CreateExecutionAsync(workflowId, "websocket", null);
                _ = Task.Run(async () =>
                {
                    await engine.ExecuteAsync(workflowId, executionId, "websocket",
                        step => _ = channel.SendFrameAsync(webSocket, new
                        {
                            type = "step",
                            execution_id = (long)executionId,
                            node_id = (long)step.NodeId,
                            status = step.Status,
                            output = step.OutputJson,
                            error = step.Error
                        }));
                });
            }
            else if (type == "ping")
            {
                await channel.SendFrameAsync(webSocket, new { type = "pong" });
            }
        }
    }
    catch (Exception ex)
    {
        try { await channel.SendFrameAsync(webSocket, new { type = "error", error = ex.Message }); } catch { }
    }
    finally
    {
        sessions.Remove(sessionId);
        channel.Dispose();
        try { if (webSocket.State == WebSocketState.Open) await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
    }
});

app.Run();

record LoginRequest(string? Username, string? Password);
record ExecuteRequest(string? TriggerType, object? InputJson);
record WorkflowDto(string Name, string? Description, string DefinitionJson, bool IsActive);
