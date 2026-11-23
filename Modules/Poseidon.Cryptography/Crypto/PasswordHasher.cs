using System.Security.Cryptography;
using System.Text;

namespace Poseidon.Cryptography.Crypto;

/// <summary>
/// PBKDF2-HMAC-SHA256 password hashing. Format: $pbkdf2v1$iterations$salt$hash (base64 salt/hash).
/// </summary>
public static class PasswordHasher
{
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const string Marker = "$pbkdf2v1$";

    public static string Hash(string password)
    {
        if (password is null) throw new ArgumentNullException(nameof(password));
        byte[] salt = RandomNumberGenerator.GetBytes(SaltSize);
        using var pbkdf2 = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256);
        byte[] hash = pbkdf2.GetBytes(HashSize);
        return Marker + Iterations + "$" + Convert.ToBase64String(salt) + "$" + Convert.ToBase64String(hash);
    }

    public static bool Verify(string password, string hashedPassword)
    {
        if (password is null) throw new ArgumentNullException(nameof(password));
        if (hashedPassword is null || !hashedPassword.StartsWith(Marker, StringComparison.Ordinal)) return false;

        var parts = hashedPassword.AsSpan(Marker.Length).Split('$');
        if (parts.Length != 2) return false;

        if (!int.TryParse(parts[0], out int iterations)) return false;
        byte[] salt = Convert.FromBase64String(parts[1]);
        byte[] expectedHash = Convert.FromBase64String(hashedPassword[(hashedPassword.LastIndexOf('$') + 1)..]);

        using var pbkdf2 = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256);
        byte[] actualHash = pbkdf2.GetBytes(expectedHash.Length);
        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
}
