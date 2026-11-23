using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices.Marshalling;
using System.Text;
using System.Threading.Tasks;

namespace Poseidon.Lua.Abstruction
{
    public abstract class BaseHandler<Client, Script>
    {
        public abstract ValueTask HandleAsync(Client client, Script script);
    }
}
