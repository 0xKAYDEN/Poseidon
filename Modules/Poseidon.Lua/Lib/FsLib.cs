using System;
using System.IO;
using NLua;

namespace Poseidon.Lua.Lib;

/// <summary>
/// Sandboxed file-system library exposed to Lua as the global `fs` table.
/// All paths are confined to a sandbox root directory.
///   local text = fs.read("input.txt")
///   fs.write("output.txt", text)
///   local ok = fs.exists("input.txt")
/// </summary>
public sealed class FsLib : LuaLib
{
    private readonly string _root;
    private readonly Lua _lua;

    public FsLib(string sandboxRoot, Lua lua)
    {
        _root = Path.GetFullPath(sandboxRoot ?? throw new ArgumentNullException(nameof(sandboxRoot)));
        Directory.CreateDirectory(_root);
        _lua = lua ?? throw new ArgumentNullException(nameof(lua));
    }

    public override string Name => "fs";

    public override void Register(LuaEngine engine, Lua lua)
    {
        lua["fs"] = new Api(this);
    }

    public sealed class Api
    {
        private readonly FsLib _lib;
        public Api(FsLib lib) => _lib = lib;

        public string? Read(string path) => _lib.Read(path);
        public void Write(string path, string content) => _lib.Write(path, content);
        public bool Exists(string path) => _lib.Exists(path);
        public LuaTable List(string? directory = null) => _lib.List(directory);
    }

    private string Resolve(string path)
    {
        if (path is null) throw new ArgumentNullException(nameof(path));
        string full = Path.GetFullPath(Path.Combine(_root, path));
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal) &&
            !full.Equals(_root, StringComparison.Ordinal))
        {
            throw new UnauthorizedAccessException($"Path escapes the sandbox: {path}");
        }
        return full;
    }

    private string? Read(string path)
    {
        string full = Resolve(path);
        if (!File.Exists(full)) return null;
        return File.ReadAllText(full);
    }

    private void Write(string path, string content)
    {
        string full = Resolve(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content ?? string.Empty);
    }

    private bool Exists(string path)
    {
        try
        {
            string full = Resolve(path);
            return File.Exists(full) || Directory.Exists(full);
        }
        catch
        {
            return false;
        }
    }

    private LuaTable List(string? directory)
    {
        string full = Resolve(directory ?? string.Empty);
        if (!Directory.Exists(full)) return _lua.NewTable();
        LuaTable list = _lua.NewTable();
        int index = 1;
        foreach (var entry in Directory.GetFileSystemEntries(full))
        {
            list[index++] = Path.GetFileName(entry);
        }
        return list;
    }
}
