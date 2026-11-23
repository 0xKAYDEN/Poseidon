using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Poseidon.Cryptography.Crypto;

/// <summary>
/// Minimal HS256 JWT implementation (zero extra NuGet packages).
/// Header: {"alg":"HS256","typ":"JWT"}; payload carries claims + exp.
/// </summary>
public sealed class JwtService
{
    private readonly byte[] _signingKey;

    public JwtService(byte[] signingKey)
    {
        if (signingKey is null) throw new ArgumentNullException(nameof(signingKey));
        if (signingKey.Length != 32) throw new ArgumentException("JWT signing key must be 256 bits", nameof(signingKey));
        _signingKey = signingKey;
    }

    public string CreateToken(IDictionary<string, object> claims, TimeSpan ttl)
    {
        if (claims is null) throw new ArgumentNullException(nameof(claims));

        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long exp = now + (long)ttl.TotalSeconds;

        var header = Base64UrlEncode(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"));
        var payload = new Dictionary<string, object>(claims, StringComparer.Ordinal) { ["exp"] = exp, ["iat"] = now };
        string payloadPart = Base64UrlEncode(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));

        string signingInput = header + "." + payloadPart;
        string signature = Base64UrlEncode(Sign(Encoding.UTF8.GetBytes(signingInput)));
        return signingInput + "." + signature;
    }

    public bool ValidateToken(string token, out Dictionary<string, string>? claims)
    {
        claims = null;
        if (string.IsNullOrEmpty(token)) return false;

        int first = token.IndexOf('.');
        int last = token.LastIndexOf('.');
        if (first <= 0 || last <= first || first == last) return false;

        string signingInput = token.AsSpan(0, last).ToString();
        string signaturePart = token[(last + 1)..];

        byte[] expected = Sign(Encoding.UTF8.GetBytes(signingInput));
        byte[] actual;
        try { actual = Convert.FromBase64String(signaturePart); }
        catch { return false; }
        if (!CryptographicOperations.FixedTimeEquals(expected, actual)) return false;

        string payloadJson;
        try { payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(token[(first + 1)..last])); }
        catch { return false; }

        using var doc = JsonDocument.Parse(payloadJson);
        if (!doc.RootElement.TryGetProperty("exp", out JsonElement expEl)) return false;
        if (expEl.GetInt64() < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;

        claims = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            if (prop.Name is "exp" or "iat") continue;
            claims[prop.Name] = prop.Value.GetString() ?? string.Empty;
        }
        return true;
    }

    private static string Base64UrlEncode(byte[] input)
    {
        return Convert.ToBase64String(input)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static byte[] Base64UrlDecode(string input)
    {
        string s = input.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
        }
        return Convert.FromBase64String(s);
    }

    private byte[] Sign(byte[] data)
    {
        using var hmac = new HMACSHA256(_signingKey);
        return hmac.ComputeHash(data);
    }
}
