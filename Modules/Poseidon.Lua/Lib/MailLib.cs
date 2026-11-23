using System.Text.Json;
using NLua;
using Lua = NLua.Lua;

namespace Poseidon.Lua.Lib;

/// <summary>
/// Mail library exposed to Lua as the global `mail` table.
/// MVP: records the send intent to the execution log. Wire SMTP/SendGrid later.
///   mail.send({ to = "alice@example.com", subject = "Hi", body = "Hello" })
/// </summary>
public sealed class MailLib : LuaLib
{
    private readonly Action<string> _log;

    public MailLib(Action<string> log)
    {
        _log = log ?? throw new ArgumentNullException(nameof(log));
    }

    public override string Name => "mail";

    public override void Register(LuaEngine engine, Lua lua)
    {
        lua["mail"] = new Api(this);
    }

    public sealed class Api
    {
        private readonly MailLib _lib;
        public Api(MailLib lib) => _lib = lib;

        public bool Send(LuaTable message)
        {
            if (message is null) throw new ArgumentNullException(nameof(message));
            string to = message["to"]?.ToString() ?? string.Empty;
            string subject = message["subject"]?.ToString() ?? string.Empty;
            string body = message["body"]?.ToString() ?? string.Empty;
            _lib._log($"[mail] to={to} subject={subject} body={JsonSerializer.Serialize(body)}");
            return true;
        }
    }
}
