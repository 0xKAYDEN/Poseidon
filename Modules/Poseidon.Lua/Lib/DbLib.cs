using System;
using System.Collections.Generic;
using System.Text.Json;
using NLua;
using Poseidon.Database.Core;

namespace Poseidon.Lua.Lib;

/// <summary>
/// Database library exposed to Lua as the global `db` table:
///   local rows = db.query("SELECT * FROM users WHERE id = ?", 42)
///   local affected = db.execute("INSERT INTO logs (...) VALUES (?)", "msg")
/// Returns are marshaled by NLua from Dictionary/object[] to Lua tables automatically.
/// </summary>
public sealed class DbLib : LuaLib
{
    private readonly NLua.Lua _lua;
    private readonly PoseidonDb _db;

    public DbLib(NLua.Lua lua, PoseidonDb db)
    {
        _lua = lua ?? throw new ArgumentNullException(nameof(lua));
        _db = db ?? throw new ArgumentNullException(nameof(db));
    }

    public override string Name => "db";

    public override void Register(Poseidon.Lua.Core.LuaEngine engine, NLua.Lua lua)
    {
        lua["db"] = new Api(this);
    }

    public sealed class Api
    {
        private readonly DbLib _lib;
        public Api(DbLib lib) => _lib = lib;

        /// <summary>Returns a list of row dictionaries (NLua converts to Lua table).</summary>
        public object Query(string sql, params object?[] parameters) => _lib.Query(sql, parameters);

        /// <summary>Returns number of affected rows.</summary>
        public double Execute(string sql, params object?[] parameters)
        {
            int affected = _lib._db.ExecuteAsync(sql, parameters).GetAwaiter().GetResult();
            return affected;
        }
    }

    /// <summary>Executes a query and returns rows as a list of dictionaries.</summary>
    private List<object?> Query(string sql, object?[] parameters)
    {
        List<Dictionary<string, object?>> rows = _db.QueryAsync(sql, parameters).GetAwaiter().GetResult();
        var result = new List<object?>(rows.Count);
        foreach (var row in rows)
        {
            result.Add(row);
        }
        return result;
    }

    private static object? ToLuaValue(object? value)
    {
        return value switch
        {
            null => null!,
            string s => s,
            bool b => b,
            byte => value,
            short => value,
            int => value,
            long => (double)(long)value,
            decimal d => (double)d,
            double => value,
            float => (double)(float)value,
            DateTime dt => dt.ToString("o", System.Globalization.CultureInfo.InvariantCulture),
            byte[] bytes => Convert.ToBase64String(bytes),
            _ => value.ToString() ?? string.Empty
        };
    }
}
