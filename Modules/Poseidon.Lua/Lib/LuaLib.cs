using NLua;
using Lua = NLua.Lua;

namespace Poseidon.Lua.Lib;

/// <summary>
/// A function library exposed globally to every Lua script (e.g. `db`, `http`, `flow`).
/// </summary>
public abstract class LuaLib
{
    public abstract string Name { get; }
    public abstract void Register(LuaEngine engine, Lua lua);
}
