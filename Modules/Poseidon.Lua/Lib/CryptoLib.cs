using System;
using System.Security.Cryptography;
using System.Text;
using NLua;
using Poseidon.Cryptography.Crypto;

namespace Poseidon.Lua.Lib;

/// <summary>
/// Cryptography helpers for Lua scripts, exposed as the global `crypto` table:
///   local digest = crypto.sha256("hello")
///   local secret = crypto.random_bytes(32)          -- base64
///   local blob   = crypto.aes_encrypt(plaintext_b64, key_b64)
///   local text   = crypto.aes_decrypt(blob_b64, key_b64)
/// </summary>
public sealed class CryptoLib : LuaLib
{
    public override string Name => "crypto";

    public override void Register(LuaEngine engine, Lua lua)
    {
        lua["crypto"] = new Api();
    }

    public sealed class Api
    {
        public string Sha256(string data) =>
            Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(data ?? string.Empty)));

        public string RandomBytes(double count)
        {
            int n = (int)Math.Round(count);
            if (n < 0 || n > 1024 * 1024) throw new ArgumentOutOfRangeException(nameof(count));
            return Convert.ToBase64String(RandomNumberGenerator.GetBytes(n));
        }

        public string AesEncrypt(string plaintextBase64, string keyBase64)
        {
            byte[] plaintext = Convert.FromBase64String(plaintextBase64 ?? string.Empty);
            byte[] key = Convert.FromBase64String(keyBase64);
            byte[] package = AesGcmEncryption.Encrypt(plaintext, key);
            return Convert.ToBase64String(package);
        }

        public string AesDecrypt(string ciphertextBase64, string keyBase64)
        {
            byte[] package = Convert.FromBase64String(ciphertextBase64);
            byte[] key = Convert.FromBase64String(keyBase64);
            byte[] plaintext = AesGcmEncryption.Decrypt(package, key);
            return Convert.ToBase64String(plaintext);
        }
    }
}
