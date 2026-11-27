using System.Net.Http.Headers;
using System.Text;
using NLua;

namespace Poseidon.Lua.Lib;

/// <summary>
/// HTTP client library exposed to Lua as the global `http` table:
///   local r = http.get("https://api.example.com", { Authorization = "Bearer ..." })
///   local r = http.post("https://api.example.com/items", json_body, { ... })
/// Returns are marshaled by NLua from Dictionary to Lua tables automatically.
/// </summary>
public sealed class HttpLib : LuaLib
{
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(30),
        DefaultRequestHeaders = { UserAgent = { new ProductInfoHeaderValue("Poseidon", "1.0") } }
    };

    public override string Name => "http";

    public override void Register(Poseidon.Lua.Core.LuaEngine engine, NLua.Lua lua)
    {
        // Expose the API object as the `http` global table.
        lua["http"] = new Api(this);
    }

    public sealed class Api
    {
        private readonly HttpLib _lib;
        public Api(HttpLib lib) => _lib = lib;

        public Dictionary<string, object?> Get(string url, NLua.LuaTable? headers = null) => _lib.Request(HttpMethod.Get, url, null, headers);

        public Dictionary<string, object?> Post(string url, string? body, NLua.LuaTable? headers = null) => _lib.Request(HttpMethod.Post, url, body, headers);
    }

    private Dictionary<string, object?> Request(HttpMethod method, string url, string? body, NLua.LuaTable? headers)
    {
        using var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }
        ApplyHeaders(request, headers);

        using var response = Client.SendAsync(request).GetAwaiter().GetResult();
        return ToResponseDictionary(response);
    }

    private static void ApplyHeaders(HttpRequestMessage request, NLua.LuaTable? headers)
    {
        if (headers is null) return;
        foreach (var key in headers.Keys)
        {
            string k = key.ToString()!;
            string v = headers[k]?.ToString() ?? string.Empty;
            if (string.Equals(k, "Content-Type", StringComparison.OrdinalIgnoreCase) && request.Content is not null)
            {
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(v);
            }
            else
            {
                request.Headers.TryAddWithoutValidation(k, v);
            }
        }
    }

    private static Dictionary<string, object?> ToResponseDictionary(System.Net.Http.HttpResponseMessage response)
    {
        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["status_code"] = (int)response.StatusCode
        };

        var hdr = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in response.Headers) hdr[h.Key] = string.Join(", ", h.Value);
        if (response.Content is not null)
        {
            foreach (var h in response.Content.Headers) hdr[h.Key] = string.Join(", ", h.Value);
        }
        result["headers"] = hdr;
        result["body"] = response.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? string.Empty;
        return result;
    }
}
