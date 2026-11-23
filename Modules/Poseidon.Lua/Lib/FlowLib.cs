using System;
using System.Collections.Generic;
using System.Threading;
using NLua;

namespace Poseidon.Lua.Lib;

/// <summary>
/// Execution-scoped flow library exposed to Lua as the global `flow` table:
///   flow.set("token", "abc")
///   local value = flow.get("token")
///   flow.sleep(1000)          -- milliseconds
///   flow.log("reached step 2")
/// State is shared between all nodes of the same execution.
/// </summary>
public sealed class FlowLib : LuaLib
{
    private readonly IDictionary<string, object?> _state;
    private readonly Action<string> _log;

    public FlowLib(IDictionary<string, object?> state, Action<string> log)
    {
        _state = state ?? throw new ArgumentNullException(nameof(state));
        _log = log ?? throw new ArgumentNullException(nameof(log));
    }

    public override string Name => "flow";

    public override void Register(LuaEngine engine, Lua lua)
    {
        lua["flow"] = new Api(this);
    }

    public sealed class Api
    {
        private readonly FlowLib _lib;
        public Api(FlowLib lib) => _lib = lib;

        public object? Get(string key) => _lib._state.TryGetValue(key, out object? value) ? value : null!;

        public void Set(string key, object? value) => _lib._state[key] = value;

        public void Sleep(double milliseconds)
        {
            int ms = (int)Math.Round(milliseconds);
            if (ms < 0 || ms > 300_000) throw new ArgumentOutOfRangeException(nameof(milliseconds));
            Thread.Sleep(ms);
        }

        public void Log(string message) => _lib._log(message ?? string.Empty);
    }
}
