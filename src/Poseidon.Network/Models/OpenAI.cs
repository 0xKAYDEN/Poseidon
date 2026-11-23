using System;
using System.Collections.Generic;
using System.Text;

namespace Poseidon.Network.Models
{
    public class OpenAI
    {
        public string ModelName { get; set; } = string.Empty;
        public string URL { get; set; } = string.Empty;
        public string APIKEY { get; set; } = string.Empty;
        public bool Stream { get; set; } = true;
    }
}
