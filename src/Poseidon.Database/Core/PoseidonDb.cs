using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;
using Poseidon.Database.Core.Configrations;
using Poseidon.Database.Models;

namespace Poseidon.Database.Core;

/// <summary>
/// Thin MySqlConnector repository layer for Poseidon.
/// Every command opens its own pooled connection so the repository is safe
/// to use as a singleton from concurrent workflow executions.
/// </summary>
public sealed class PoseidonDb : IDisposable
{
    private readonly DatabaseConfigrations _config;
    private readonly string _connectionString;
    private bool _disposed;

    public PoseidonDb(DatabaseConfigrations config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        var cs = new MySqlConnectionStringBuilder
        {
            Server = _config.HostAddress,
            Port = (uint)_config.DatabasePort,
            UserID = _config.Username,
            Password = _config.Password,
            Database = _config.Schema,
            SslMode = MySqlSslMode.Preferred,
            AllowPublicKeyRetrieval = true,
            CommandTimeout = 30,
            Pooling = true,
            MinimumPoolSize = 0,
            MaximumPoolSize = 50
        };
        _connectionString = cs.ConnectionString;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task OpenAsync(CancellationToken ct = default)
    {
        // Kept for API compatibility; per-command methods manage their own connections.
        await Task.CompletedTask;
    }

    public void Dispose()
    {
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    // ---------- Workflows ----------

    public async Task<List<Workflow>> GetWorkflowsAsync(CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, name, description, definition_json, is_active, created_at, updated_at
            FROM workflows ORDER BY created_at DESC";
        return await ReadWorkflowsAsync(cmd, ct);
    }

    public async Task<Workflow?> GetWorkflowAsync(ulong id, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, name, description, definition_json, is_active, created_at, updated_at
            FROM workflows WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)id);
        var list = await ReadWorkflowsAsync(cmd, ct);
        return list.Count > 0 ? list[0] : null;
    }

    public async Task<ulong> CreateWorkflowAsync(Workflow workflow, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO workflows (name, description, definition_json, is_active)
            VALUES (@name, @description, @definition_json, @is_active);
            SELECT LAST_INSERT_ID();";
        cmd.Parameters.AddWithValue("@name", workflow.Name);
        cmd.Parameters.AddWithValue("@description", (object?)workflow.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@definition_json", workflow.DefinitionJson);
        cmd.Parameters.AddWithValue("@is_active", workflow.IsActive ? 1 : 0);
        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return ToULong(result);
    }

    public async Task<bool> UpdateWorkflowAsync(Workflow workflow, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            UPDATE workflows
            SET name = @name, description = @description, definition_json = @definition_json,
                is_active = @is_active, updated_at = CURRENT_TIMESTAMP
            WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)workflow.Id);
        cmd.Parameters.AddWithValue("@name", workflow.Name);
        cmd.Parameters.AddWithValue("@description", (object?)workflow.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@definition_json", workflow.DefinitionJson);
        cmd.Parameters.AddWithValue("@is_active", workflow.IsActive ? 1 : 0);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
    }

    public async Task<bool> DeleteWorkflowAsync(ulong id, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM workflows WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)id);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
    }

    // ---------- Nodes / edges ----------

    public async Task<List<WorkflowNode>> GetNodesAsync(ulong workflowId, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, workflow_id, type, name, config_json, lua_script_id, position_x, position_y
            FROM workflow_nodes WHERE workflow_id = @wid ORDER BY id";
        cmd.Parameters.AddWithValue("@wid", (long)workflowId);
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        var list = new List<WorkflowNode>();
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            list.Add(new WorkflowNode
            {
                Id = (ulong)reader.GetInt64(0),
                WorkflowId = (ulong)reader.GetInt64(1),
                Type = reader.GetString(2),
                Name = reader.GetString(3),
                ConfigJson = reader.IsDBNull(4) ? null : reader.GetString(4),
                LuaScriptId = reader.IsDBNull(5) ? null : (ulong?)reader.GetInt64(5),
                PositionX = reader.GetInt32(6),
                PositionY = reader.GetInt32(7)
            });
        }
        return list;
    }

    public async Task<List<WorkflowEdge>> GetEdgesAsync(ulong workflowId, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT id, workflow_id, source_node_id, target_node_id, condition_type, condition_expression
            FROM workflow_edges WHERE workflow_id = @wid ORDER BY id";
        cmd.Parameters.AddWithValue("@wid", (long)workflowId);
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        var list = new List<WorkflowEdge>();
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            list.Add(new WorkflowEdge
            {
                Id = (ulong)reader.GetInt64(0),
                WorkflowId = (ulong)reader.GetInt64(1),
                SourceNodeId = (ulong)reader.GetInt64(2),
                TargetNodeId = (ulong)reader.GetInt64(3),
                ConditionType = reader.GetString(4),
                ConditionExpression = reader.IsDBNull(5) ? null : reader.GetString(5)
            });
        }
        return list;
    }

    public async Task<List<Script>> GetScriptsAsync(CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name, content, version, created_at FROM scripts ORDER BY name";
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        var list = new List<Script>();
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            list.Add(new Script
            {
                Id = (ulong)reader.GetInt64(0),
                Name = reader.GetString(1),
                Content = reader.GetString(2),
                Version = (int)reader.GetInt64(3),
                CreatedAt = reader.GetDateTime(4)
            });
        }
        return list;
    }

    public async Task<string?> GetScriptContentAsync(ulong scriptId, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT content FROM scripts WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)scriptId);
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        return await reader.ReadAsync(ct).ConfigureAwait(false) ? reader.GetString(0) : null;
    }

    // ---------- Executions ----------

    public async Task<ulong> CreateExecutionAsync(ulong workflowId, string triggerType, string? inputJson, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO executions (workflow_id, status, trigger_type, input_json, started_at)
            VALUES (@wid, 'queued', @trigger, @input, CURRENT_TIMESTAMP);
            SELECT LAST_INSERT_ID();";
        cmd.Parameters.AddWithValue("@wid", (long)workflowId);
        cmd.Parameters.AddWithValue("@trigger", triggerType);
        cmd.Parameters.AddWithValue("@input", (object?)inputJson ?? DBNull.Value);
        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return ToULong(result);
    }

    public async Task<bool> UpdateExecutionStatusAsync(ulong executionId, string status, string? outputJson = null, string? error = null, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            UPDATE executions
            SET status = @status, output_json = @output, error = @error,
                finished_at = CASE WHEN @status IN ('completed','failed','cancelled') THEN CURRENT_TIMESTAMP ELSE finished_at END
            WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)executionId);
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@output", (object?)outputJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@error", (object?)error ?? DBNull.Value);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
    }

    public async Task<bool> MarkExecutionRunningAsync(ulong executionId, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE executions SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)executionId);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
    }

    public async Task<ulong> CreateStepAsync(ulong executionId, ulong nodeId, string? inputJson, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO execution_steps (execution_id, node_id, status, input_json, started_at)
            VALUES (@eid, @nid, 'running', @input, CURRENT_TIMESTAMP);
            SELECT LAST_INSERT_ID();";
        cmd.Parameters.AddWithValue("@eid", (long)executionId);
        cmd.Parameters.AddWithValue("@nid", (long)nodeId);
        cmd.Parameters.AddWithValue("@input", (object?)inputJson ?? DBNull.Value);
        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return ToULong(result);
    }

    public async Task<bool> CompleteStepAsync(ulong stepId, string status, string? outputJson = null, string? error = null, long? durationMs = null, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            UPDATE execution_steps
            SET status = @status, output_json = @output, error = @error,
                duration_ms = @duration, finished_at = CURRENT_TIMESTAMP
            WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", (long)stepId);
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@output", (object?)outputJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@error", (object?)error ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@duration", (object?)durationMs ?? DBNull.Value);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
    }

    // ---------- Credentials ----------

    public async Task<Credential?> GetCredentialAsync(string name, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name, type, encrypted_json, created_at FROM credentials WHERE name = @name";
        cmd.Parameters.AddWithValue("@name", name);
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return new Credential
        {
            Id = (ulong)reader.GetInt64(0),
            Name = reader.GetString(1),
            Type = reader.GetString(2),
            EncryptedJson = reader.GetString(3),
            CreatedAt = reader.GetDateTime(4)
        };
    }

    public async Task<ulong> SaveCredentialAsync(Credential credential, CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct).ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO credentials (name, type, encrypted_json)
            VALUES (@name, @type, @json)
            ON DUPLICATE KEY UPDATE type = VALUES(type), encrypted_json = VALUES(encrypted_json)";
        cmd.Parameters.AddWithValue("@name", credential.Name);
        cmd.Parameters.AddWithValue("@type", credential.Type);
        cmd.Parameters.AddWithValue("@json", credential.EncryptedJson);
        var result = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return ToULong(result);
    }

    // ---------- Helpers exposed to the Lua db lib ----------

    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync().ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        for (int i = 0; i < parameters.Length; i++)
        {
            cmd.Parameters.AddWithValue($"@p{i}", parameters[i] ?? DBNull.Value);
        }
        using var reader = await cmd.ExecuteReaderAsync().ConfigureAwait(false);
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync().ConfigureAwait(false))
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }
            rows.Add(row);
        }
        return rows;
    }

    public async Task<int> ExecuteAsync(string sql, params object?[] parameters)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync().ConfigureAwait(false);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        for (int i = 0; i < parameters.Length; i++)
        {
            cmd.Parameters.AddWithValue($"@p{i}", parameters[i] ?? DBNull.Value);
        }
        return await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
    }

    private static async Task<List<Workflow>> ReadWorkflowsAsync(MySqlCommand cmd, CancellationToken ct)
    {
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        var list = new List<Workflow>();
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            list.Add(new Workflow
            {
                Id = (ulong)reader.GetInt64(0),
                Name = reader.GetString(1),
                Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                DefinitionJson = reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                IsActive = reader.GetBoolean(4),
                CreatedAt = reader.GetDateTime(5),
                UpdatedAt = reader.GetDateTime(6)
            });
        }
        return list;
    }

    private static ulong ToULong(object result)
    {
        return (ulong)Convert.ToDecimal(result, CultureInfo.InvariantCulture);
    }
}

public sealed class Script
{
    public ulong Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
}
