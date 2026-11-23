using System;
using System.Collections.Generic;
using System.Text;

namespace Poseidon.Database.Model
{
    public class ActionModel
    {
        public uint Id { get; set; }
        public uint IdNext { get; set; }
        public uint IdNextFail { get; set; }
        public uint Type { get; set; }
        public uint Data { get; set; }
        public uint Parameter { get; set; }
    }
}
