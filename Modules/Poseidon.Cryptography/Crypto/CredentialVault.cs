using System.Security.Cryptography;
using System.Text;

namespace Poseidon.Cryptography.Crypto;

/// <summary>
/// Encrypts sensitive credential JSON at rest with AES-256-GCM under a master key.
/// </summary>
public sealed class CredentialVault
{
    private readonly byte[] _masterKey;

    public CredentialVault(byte[] masterKey)
    {
        if (masterKey is null) throw new ArgumentNullException(nameof(masterKey));
        if (masterKey.Length != 32) throw new ArgumentException("Master key must be 256 bits (32 bytes)", nameof(masterKey));
        _masterKey = masterKey;
    }

    public string Encrypt(string plaintextJson)
    {
        if (plaintextJson is null) throw new ArgumentNullException(nameof(plaintextJson));
        byte[] package = AesGcmEncryption.Encrypt(Encoding.UTF8.GetBytes(plaintextJson), _masterKey);
        return Convert.ToBase64String(package);
    }

    public string Decrypt(string ciphertextBase64)
    {
        if (ciphertextBase64 is null) throw new ArgumentNullException(nameof(ciphertextBase64));
        byte[] package = Convert.FromBase64String(ciphertextBase64);
        byte[] plaintext = AesGcmEncryption.Decrypt(package, _masterKey);
        return Encoding.UTF8.GetString(plaintext);
    }
}
