using System;

namespace PoseidonClient;

/// <summary>
/// Data model for a workflow node on the canvas.
/// </summary>
public class NodeViewModel
{
    public string Id { get; set; }
    public string Type { get; set; }
    public string Name { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public string Script { get; set; }

    public NodeViewModel(string id, string type, string name, double x, double y, string script)
    {
        Id = id;
        Type = type;
        Name = name;
        X = x;
        Y = y;
        Script = script;
    }
}

/// <summary>
/// Data model for an edge between two workflow nodes.
/// </summary>
public class EdgeViewModel
{
    public string Id { get; } = Guid.NewGuid().ToString("N")[..8];
    public string SourceNodeId { get; }
    public string TargetNodeId { get; }
    public string Condition { get; } // always | on_success | on_error | expression

    public EdgeViewModel(string sourceNodeId, string targetNodeId, string condition)
    {
        SourceNodeId = sourceNodeId;
        TargetNodeId = targetNodeId;
        Condition = condition;
    }
}
