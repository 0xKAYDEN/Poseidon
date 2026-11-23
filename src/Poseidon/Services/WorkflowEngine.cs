using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Poseidon.Database.Core;
using Poseidon.Database.Models;
using Poseidon.Lua.Core;
using Poseidon.Lua.Lib;

namespace Poseidon.Services;

/// <summary>
/// Outcome of running a single workflow node.
/// </summary>
public sealed class StepEvent
{
    public ulong NodeId { get; set; }
    public string Status { get; set; } = "running";
    public string? OutputJson { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Executes a Poseidon workflow: every node is a Lua script, wired together through
/// MySQL-stored edges (on_success / on_error routing, like ActionModel.IdNext / IdNextFail).
/// </summary>
public sealed class WorkflowEngine
{
    private readonly PoseidonDb _db;
    private readonly TimeSpan _nodeTimeout = TimeSpan.FromSeconds(30);

    public WorkflowEngine(PoseidonDb db) => _db = db;

    public async Task ExecuteAsync(
        ulong workflowId,
        ulong executionId,
        string triggerType,
        Action<StepEvent>? onStep = null,
        CancellationToken ct = default)
    {
        await _db.MarkExecutionRunningAsync(executionId, ct);

        List<WorkflowNode> nodes = await _db.GetNodesAsync(workflowId, ct);
        List<WorkflowEdge> edges = await _db.GetEdgesAsync(workflowId, ct);
        if (nodes.Count == 0)
        {
            await _db.UpdateExecutionStatusAsync(executionId, "completed", error: "no nodes", ct: ct);
            return;
        }

        var predecessors = edges.GroupBy(e => e.TargetNodeId)
            .ToDictionary(g => g.Key, g => (List<WorkflowEdge>)g.ToList());
        var successors = edges.GroupBy(e => e.SourceNodeId)
            .ToDictionary(g => g.Key, g => (List<WorkflowEdge>)g.ToList());

        int[] pendingPred = nodes.Select(n =>
            predecessors.TryGetValue(n.Id, out var p) ? p.Count : 0).ToArray();
        var indexOf = nodes.ToDictionary(n => n.Id, n => n);

        var queue = new Queue<WorkflowNode>(nodes.Where(n => pendingPred[nodes.IndexOf(n)] == 0));

        var outputs = new Dictionary<ulong, Dictionary<string, object?>>();
        var failedNodes = new HashSet<ulong>();
        var skippedNodes = new HashSet<ulong>();

        // flow.get / flow.set state shared by every node of this execution.
        var sharedState = new Dictionary<string, object?>(StringComparer.Ordinal);
        Action<string> log = msg => Console.WriteLine($"[flow][execution {executionId}] {msg}");

        async Task<bool> RunNodeAsync(WorkflowNode node, Dictionary<string, object?> inputs)
        {
            string? scriptSource = node.LuaScriptId is null
                ? null
                : await _db.GetScriptContentAsync(node.LuaScriptId.Value, ct);
            if (string.IsNullOrEmpty(scriptSource))
            {
                ulong stepIdA = await _db.CreateStepAsync(executionId, node.Id,
                    JsonSerializer.Serialize(inputs), ct);
                await _db.CompleteStepAsync(stepIdA, "failed",
                    error: $"node {node.Id} has no Lua script", ct: ct);
                onStep?.Invoke(new StepEvent { NodeId = node.Id, Status = "failed",
                    Error = $"node {node.Id} has no Lua script" });
                return false;
            }

            ulong stepIdB = await _db.CreateStepAsync(executionId, node.Id,
                JsonSerializer.Serialize(inputs), ct);

            using var engine = CreateEngine(sharedState, log);
            object module;
            try { module = engine.LoadScript("node_" + node.Id, scriptSource); }
            catch (Exception ex)
            {
                await _db.CompleteStepAsync(stepIdB, "failed", error: ex.Message, ct: ct);
                onStep?.Invoke(new StepEvent { NodeId = node.Id, Status = "failed", Error = ex.Message });
                return false;
            }

            var context = new Dictionary<string, object?>
            {
                ["inputs"] = inputs,
                ["node"] = new Dictionary<string, object?>
                {
                    ["id"] = (double)node.Id,
                    ["name"] = node.Name,
                    ["type"] = node.Type
                },
                ["secrets"] = new Dictionary<string, object?>()
            };

            Dictionary<string, object?> result;
            try
            {
                result = await engine.RunAsync(module, context, ct);
            }
            catch (Exception ex)
            {
                await _db.CompleteStepAsync(stepIdB, "failed", error: ex.Message, ct: ct);
                onStep?.Invoke(new StepEvent { NodeId = node.Id, Status = "failed", Error = ex.Message });
                return false;
            }

            await _db.CompleteStepAsync(stepIdB, "completed",
                outputJson: JsonSerializer.Serialize(result), ct: ct);
            onStep?.Invoke(new StepEvent
            {
                NodeId = node.Id,
                Status = "completed",
                OutputJson = JsonSerializer.Serialize(result)
            });
            outputs[node.Id] = result;
            return true;
        }

        while (queue.Count > 0 && !ct.IsCancellationRequested)
        {
            WorkflowNode node = queue.Dequeue();

            // Inputs from predecessor outputs.
            var inputs = new Dictionary<string, object?>();
            if (predecessors.TryGetValue(node.Id, out var preds))
            {
                foreach (var edge in preds)
                {
                    if (outputs.TryGetValue(edge.SourceNodeId, out var predOutput))
                    {
                        inputs[edge.SourceNodeId.ToString()] = predOutput;
                        inputs["prev"] = predOutput;
                    }
                }
            }

            // A failed predecessor blocks all outgoing edges except on_error ones.
            bool hasFailedPred = preds != null && preds.Any(e => failedNodes.Contains(e.SourceNodeId));
            if (hasFailedPred)
            {
                bool hasErrorEdge = preds.Any(e =>
                    edges.Any(x => x.SourceNodeId == e.SourceNodeId && x.TargetNodeId == node.Id && x.ConditionType == "on_error"));
                if (!hasErrorEdge)
                {
                    skippedNodes.Add(node.Id);
                    ulong stepIdC = await _db.CreateStepAsync(executionId, node.Id, null, ct);
                    await _db.CompleteStepAsync(stepIdC, "skipped", ct: ct);
                    EnqueueSuccessors(node);
                    continue;
                }
            }

            bool ok = await RunNodeAsync(node, inputs);
            if (!ok) failedNodes.Add(node.Id);
            EnqueueSuccessors(node);
        }

        string finalStatus = ct.IsCancellationRequested ? "cancelled" :
            (failedNodes.Count > 0 ? "failed" : "completed");
        await _db.UpdateExecutionStatusAsync(executionId, finalStatus,
            error: failedNodes.Count > 0 ? "one or more nodes failed" : null, ct: ct);

        void EnqueueSuccessors(WorkflowNode n)
        {
            if (!successors.TryGetValue(n.Id, out var sucs)) return;
            foreach (var succ in sucs)
            {
                if (--pendingPred[Array.IndexOf(nodes.Select(x => x.Id).ToArray(), succ.TargetNodeId)] == 0 &&
                    !skippedNodes.Contains(succ.TargetNodeId) && !failedNodes.Contains(succ.TargetNodeId))
                {
                    queue.Enqueue(indexOf[succ.TargetNodeId]);
                }
            }
        }
    }

    private LuaEngine CreateEngine(Dictionary<string, object?> sharedState, Action<string> log)
    {
        var lua = new NLua.Lua();
        lua.LoadString("io = nil; os = nil; package = nil; loadfile = nil; dofile = nil;", "sandbox").Call();

        string sandbox = Path.Combine(AppContext.BaseDirectory, "scripts", "sandbox");
        var libs = new Poseidon.Lua.Lib.LuaLib[]
        {
            new DbLib(lua, _db),
            new HttpLib(lua),
            new FsLib(sandbox),
            new CryptoLib(),
            new FlowLib(sharedState, log),
            new MailLib(log),
            new AiLib(lua)
        };

        var engine = new LuaEngine(_nodeTimeout, libs);
        foreach (var lib in libs)
        {
            lib.Register(engine, lua);
        }
        return engine;
    }
}
