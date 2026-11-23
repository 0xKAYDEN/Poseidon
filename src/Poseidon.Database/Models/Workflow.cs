using System.Text.Json;

namespace Poseidon.Database.Models;

public class Workflow
{
    public ulong Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string DefinitionJson { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public T? DefinitionAs<T>() where T : class
    {
        return string.IsNullOrWhiteSpace(DefinitionJson) ? null : JsonSerializer.Deserialize<T>(DefinitionJson);
    }
}

public class WorkflowNode
{
    public ulong Id { get; set; }
    public ulong WorkflowId { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? ConfigJson { get; set; }
    public ulong? LuaScriptId { get; set; }
    public int PositionX { get; set; }
    public int PositionY { get; set; }
}

public class WorkflowEdge
{
    public ulong Id { get; set; }
    public ulong WorkflowId { get; set; }
    public ulong SourceNodeId { get; set; }
    public ulong TargetNodeId { get; set; }
    public string ConditionType { get; set; } = "always"; // always | on_success | on_error | expression
    public string? ConditionExpression { get; set; }
}

public class Execution
{
    public ulong Id { get; set; }
    public ulong WorkflowId { get; set; }
    public string Status { get; set; } = "queued"; // queued | running | completed | failed | cancelled
    public string TriggerType { get; set; } = "manual"; // manual | schedule | webhook
    public string? InputJson { get; set; }
    public string? OutputJson { get; set; }
    public string? Error { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

public class ExecutionStep
{
    public ulong Id { get; set; }
    public ulong ExecutionId { get; set; }
    public ulong NodeId { get; set; }
    public string Status { get; set; } = "queued"; // queued | running | completed | failed | skipped
    public string? InputJson { get; set; }
    public string? OutputJson { get; set; }
    public string? Error { get; set; }
    public long? DurationMs { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

public class Credential
{
    public ulong Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string EncryptedJson { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
