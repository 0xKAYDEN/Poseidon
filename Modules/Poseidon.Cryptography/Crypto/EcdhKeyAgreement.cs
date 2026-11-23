using System.Security.Cryptography;

namespace Poseidon.Cryptography.Crypto;

/// <summary>
/// X25519 elliptic-curve Diffie-Hellman key agreement.
/// Both sides derive the same 256-bit shared key material usable directly as an AES-256 key.
/// </summary>
public sealed class EcdhKeyAgreement : IDisposable
{
    private readonly ECDiffieHellman _ecdh;

    public EcdhKeyAgreement()
    {
        // Curve25519 is supported on Windows (CNG) and Linux (OpenSSL 1.1.1+ / 3.x) in .NET 9+.
        _ecdh = ECDiffieHellman.Create(ECCurve.CreateFromFriendlyName("Curve25519"));
    }

    public byte[] GetPublicKey() => _ecdh.PublicKey.ExportSubjectPublicKeyInfo();

    /// <summary>Derives symmetric key material from the other party's public key (SPKI DER).</summary>
    public byte[] DeriveKey(byte[] otherPublicKeySpki)
    {
        using var other = ECDiffieHellman.Create();
        other.ImportSubjectPublicKeyInfo(otherPublicKeySpki, out _);
        byte[] shared = _ecdh.DeriveKeyFromHash(other.PublicKey, HashAlgorithmName.SHA256);
        return shared; // 256 bits for Curve25519
    }

    public void Dispose()
    {
        _ecdh.Dispose();
        GC.SuppressFinalize(this);
    }
}
