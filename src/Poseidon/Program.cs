using Poseidon.Lua.IO;
public class Program
{
    public static void Main(string[] args)
    {
        var scriptManager = new ScriptManager(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "database", "lua"));
        Console.ReadLine();
    }
}
