using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NLua;

namespace Poseidon.Lua.Core;

/// <summary>
/// Hosts the NLua runtime and executes Poseidon automation scripts.
///
/// Each script is a Lua chunk that returns a module table:
//     return { run = function(context) ... end }
// The engine registers the global function libraries (db, http, fs, crypto, flow, ...)
// and invokes run(context). One engine instance is created per node execution to
/// isolate scripts from each other (no shared mutable Lua state).
/// </summary>
public sealed class LuaEngine : IDisposable
{
    private readonly NLua.Lua _lua;
    private readonly TimeSpan _executionTimeout;

    public LuaEngine(TimeSpan executionTimeout, IEnumerable<Poseidon.Lua.Lib.LuaLib> libraries)
    {
        _executionTimeout = executionTimeout;
        _lua = new NLua.Lua();

        // Neutralize dangerous standard-library access for untrusted scripts.
        _lua.LoadString("io = nil; os = nil; package = nil; loadfile = nil; dofile = nil;", "sandbox").Call();

        foreach (var lib in libraries ?? Enumerable.Empty<Poseidon.Lua.Lib.LuaLib>())
        {
            lib.Register(this, _lua);
        }
    }

    /// <summary>Loads a script chunk. Returns the module table the chunk evaluates to.</summary>
    public LuaTable LoadScript(string name, string source)
    {
        if (source is null) throw new ArgumentNullException(nameof(source));
        var chunk = _lua.LoadString(source, name);
        object[] result = chunk.Call();
        if (result.Length == 0 || result[0] is not LuaTable table)
        {
            throw new InvalidOperationException($"Script '{name}' did not return a module table");
        }
        return table;
    }

    /// <summary>Executes run(context) on a loaded module table with a timeout.</summary>
    public async Task<Dictionary<string, object?>> RunAsync(LuaTable module, Dictionary<string, object?> context, CancellationToken ct = default)
    {
        if (module is null) throw new ArgumentNullException(nameof(module));
        if (module["run"] is null) throw new InvalidOperationException("Script module is missing a 'run' function");
        if (module["run"] is not LuaFunction run) throw new InvalidOperationException("'run' is not a function");

        LuaTable contextTable = BuildContextTable(context);

        try
        {
            var task = Task.Run(() =>
            {
                object[] result = run.Call(contextTable);
                return ToDictionary(result.Length > 0 ? result[0] : null);
            }, ct);

            await task.WaitAsync(_executionTimeout, ct).ConfigureAwait(false);
            return task.Result;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw new TimeoutException($"Lua script execution exceeded {_executionTimeout.TotalSeconds}s");
        }
    }

    /// <summary>Sets a global value visible to every script in this engine.</summary>
    public void SetGlobal(string name, object value)
    {
        _lua[name] = value;
    }

    private LuaTable BuildContextTable(Dictionary<string, object?> context)
    {
        LuaTable table = _lua.NewTable("");
        foreach (var kv in context)
        {
            table[kv.Key] = ToLuaValue(kv.Value);
        }
        return table;
    }

    private static Dictionary<string, object?> ToDictionary(object? value)
    {
        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (value is LuaTable table)
        {
            foreach (var key in table.Keys)
            {
                result[key.ToString()] = ToClrValue(table[key]);
            }
        }
        return result;
    }

    private object ToLuaValue(object? value)
    {
        return value switch
        {
            null => null!,
            string s => s,
            bool b => b,
            byte => value,
            short => value,
            int => value,
            long => value,
            float => value,
            double => value,
            decimal d => (double)d,
            IDictionary<string, object?> dict => FromDictionary(dict),
            _ => value.ToString() ?? string.Empty
        };
    }

    private LuaTable FromDictionary(IDictionary<string, object?> dict)
    {
        LuaTable table = _lua.NewTable("");
        foreach (var kv in dict)
        {
            table[kv.Key] = ToLuaValue(kv.Value);
        }
        return table;
    }

    private static object ToClrValue(object? value)
    {
        return value switch
        {
            LuaTable lt => ToDictionary(lt),
            string s => s,
            bool b => b,
            double d => d,
            int i => i,
            long l => l,
            nil _ => null!,
            _ => value?.ToString() ?? string.Empty
        };
    }

    public void Dispose()
    {
        _lua.Dispose();
        GC.SuppressFinalize(this);
    }
}

// NLua represents nil as its own typed marker.
internal sealed record nil;
