using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Poseidon.Cryptography.Crypto;

/// <summary>
/// Application-layer secure channel on top of an already-authenticated transport (TLS/WSS).
///
/// Envelope (all base64):  { "body": "..." }
/// body = base64(nonce(12) || ciphertext || tag(16)) produced by AES-256-GCM.
///
/// Handshake (one round trip):
///   server -> client: { "type": "channel_hello", "server_key": "<x25519 spki base64>" }
///   client -> server: { "type": "channel_ready", "client_key": "<x25519 spki base64>" }
/// Both sides then derive the same AES-256 key via ECDH and encrypt every frame.
/// </summary>
public sealed class SecureChannel
{
    private readonly EcdhKeyAgreement _local = new();
    private byte[]? _sessionKey;
    private bool _keyEstablished;

    public byte[] LocalPublicKey => _local.GetPublicKey();

    public bool IsEncrypted => _keyEstablished && _sessionKey is not null;

    /// <summary>Processes the remote public key and establishes the session key.</summary>
    public void Establish(byte[] remotePublicKeySpki)
    {
        if (_keyEstablished) throw new InvalidOperationException("Session key already established");
        _sessionKey = _local.DeriveKey(remotePublicKeySpki);
        _keyEstablished = true;
    }

    /// <summary>Encrypts a JSON message into an envelope.</summary>
    public string Encrypt(string jsonMessage)
    {
        if (!_keyEstablished) throw new InvalidOperationException("Session key not established");
        if (jsonMessage is null) throw new ArgumentNullException(nameof(jsonMessage));
        byte[] package = AesGcmEncryption.Encrypt(Encoding.UTF8.GetBytes(jsonMessage), _sessionKey!);
        var envelope = new { nonce = string.Empty, body = Convert.ToBase64String(package), tag = string.Empty };
        // nonce/tag are inside `package`; we keep a single base64 body for simplicity.
        return JsonSerializer.Serialize(envelope);
    }

    /// <summary>Decrypts an envelope back into the original JSON message.</summary>
    public string Decrypt(string envelopeJson)
    {
        if (!_keyEstablished) throw new InvalidOperationException("Session key not established");
        if (envelopeJson is null) throw new ArgumentNullException(nameof(envelopeJson));
        using var doc = JsonDocument.Parse(envelopeJson);
        if (!doc.RootElement.TryGetProperty("body", out JsonElement bodyEl)) throw new FormatException("Envelope missing body");
        byte[] package = Convert.FromBase64String(bodyEl.GetString()!);
        byte[] plaintext = AesGcmEncryption.Decrypt(package, _sessionKey!);
        return Encoding.UTF8.GetString(plaintext);
    }

    /// <summary>Sends the channel handshake hello (plaintext JSON over the TLS-protected socket).</summary>
    public Task SendHello(WebSocket webSocket, CancellationToken ct = default)
    {
        var hello = new { type = "channel_hello", server_key = Convert.ToBase64String(LocalPublicKey) };
        return SendRaw(webSocket, JsonSerializer.Serialize(hello), ct);
    }

    /// <summary>Receives one complete text frame and returns its raw string (the encrypted envelope JSON).</summary>
    public async Task<string?> ReceiveFrameAsync(WebSocket webSocket, CancellationToken ct = default)
    {
        using var ms = new MemoryStream();
        var buffer = new byte[4096];
        WebSocketReceiveResult result;
        do
        {
            result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    /// <summary>Serializes obj, encrypts it, and sends as one text frame.</summary>
    public Task SendFrameAsync(WebSocket webSocket, object message, CancellationToken ct = default)
    {
        string json = JsonSerializer.Serialize(message);
        string envelope = Encrypt(json);
        return SendRaw(webSocket, envelope, ct);
    }

    private static Task SendRaw(WebSocket webSocket, string text, CancellationToken ct)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        return webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    public void Dispose() => _local.Dispose();
}
