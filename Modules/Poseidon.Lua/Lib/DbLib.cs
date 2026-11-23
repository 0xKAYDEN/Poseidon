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
/// Rows come back as a list of tables; cell values are string/number/bool/null.
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

        public LuaTable Query(string sql, params object?[] parameters) => _lib.Query(sql, parameters);

        public double Execute(string sql, params object?[] parameters)
        {
            int affected = _lib._db.ExecuteAsync(sql, parameters).GetAwaiter().GetResult();
            return affected;
        }
    }

    private LuaTable Query(string sql, object?[] parameters)
    {
        List<Dictionary<string, object?>> rows = _db.QueryAsync(sql, parameters).GetAwaiter().GetResult();
        LuaTable list = _lua.NewTable("");
        int index = 1;
        foreach (var row in rows)
        {
            LuaTable t = _lua.NewTable("");
            foreach (var kv in row)
            {
                t.RawSet(kv.Key, ToLuaValue(kv.Value));
            }
            list.RawSet(index++, t);
        }
        return list;
    }

    private static object ToLuaValue(object? value)
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
