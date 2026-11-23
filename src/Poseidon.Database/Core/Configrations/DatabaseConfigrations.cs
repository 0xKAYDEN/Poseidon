using System;
using System.Collections.Generic;
using System.Text;

namespace Poseidon.Database.Core.Configrations
{
    public class DatabaseConfigrations
    {
        public string HostAddress { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string Schema { get; set; } = string.Empty;
        public int DatabasePort { get; set; }
    }
}
