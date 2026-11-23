using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Poseidon.Lua.IO
{
    public class ScriptManager
    {
        public Dictionary<int, string> Scripts { get; private set; } = new Dictionary<int, string>();
        public ScriptManager(string dir)
        {
            LoadScripts(dir);
        }

        internal void LoadScripts(string dir)
        {
            // Load scripts from the specified directory
            try
            {
                foreach (var file in Directory.GetFiles(dir, "*.lua"))
                {
                    var scriptId = int.Parse(Path.GetFileNameWithoutExtension(file));
                    var scriptContent = File.ReadAllText(file);
                    Scripts[scriptId] = scriptContent;
                    Console.WriteLine($"Loaded script: {file} with ID: {scriptId}");
                    Console.WriteLine($"Loaded script content : {scriptContent}");
                }
                Console.WriteLine($"Loaded {Scripts.Count} scripts from {dir}");
            }
            catch(Exception ex)
            {
                Console.WriteLine(ex.ToString());
            }
        }
    }
}
