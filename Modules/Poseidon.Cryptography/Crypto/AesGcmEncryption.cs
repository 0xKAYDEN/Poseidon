using System.Security.Cryptography;

namespace Poseidon.Cryptography.Crypto;

/// <summary>
/// AES-256-GCM authenticated encryption.
/// Package format: nonce(12) || ciphertext || tag(16).
/// </summary>
public static class AesGcmEncryption
{
    private const int KeySize = 32;
    private const int NonceSize = 12;
    private const int TagSize = 16;

    /// <summary>Encrypts plaintext. Returns nonce || ciphertext || tag.</summary>
    public static byte[] Encrypt(byte[] plaintext, byte[] key, byte[]? additionalData = null)
    {
        if (key is null) throw new ArgumentNullException(nameof(key));
        if (key.Length != KeySize) throw new ArgumentException("AES-256 requires a 32-byte key", nameof(key));
        if (plaintext is null) throw new ArgumentNullException(nameof(plaintext));

        byte[] nonce = RandomNumberGenerator.GetBytes(NonceSize);
        byte[] ciphertext = new byte[plaintext.Length];
        byte[] tag = new byte[TagSize];

        using var aes = new AesGcm(key);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, additionalData);

        var package = new byte[NonceSize + ciphertext.Length + TagSize];
        Buffer.BlockCopy(nonce, 0, package, 0, NonceSize);
        Buffer.BlockCopy(ciphertext, 0, package, NonceSize, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, package, NonceSize + ciphertext.Length, TagSize);
        return package;
    }

    /// <summary>Decrypts a package produced by <see cref="Encrypt"/>.</summary>
    public static byte[] Decrypt(byte[] package, byte[] key, byte[]? additionalData = null)
    {
        if (package is null) throw new ArgumentNullException(nameof(package));
        if (key is null) throw new ArgumentNullException(nameof(key));
        if (key.Length != KeySize) throw new ArgumentException("AES-256 requires a 32-byte key", nameof(key));
        if (package.Length < NonceSize + TagSize) throw new ArgumentException("Encrypted package is too short", nameof(package));

        byte[] nonce = new byte[NonceSize];
        byte[] ciphertext = new byte[package.Length - NonceSize - TagSize];
        byte[] tag = new byte[TagSize];

        Buffer.BlockCopy(package, 0, nonce, 0, NonceSize);
        Buffer.BlockCopy(package, NonceSize, ciphertext, 0, ciphertext.Length);
        Buffer.BlockCopy(package, NonceSize + ciphertext.Length, tag, 0, TagSize);

        using var aes = new AesGcm(key);
        byte[] plaintext = new byte[ciphertext.Length];
        aes.Decrypt(nonce, ciphertext, tag, plaintext, additionalData);
        return plaintext;
    }

    public static byte[] GenerateKey() => RandomNumberGenerator.GetBytes(KeySize);
}
