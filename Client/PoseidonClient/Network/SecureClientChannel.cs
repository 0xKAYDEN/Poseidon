using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Poseidon.Cryptography.Crypto;

namespace PoseidonClient.Network;

/// <summary>
/// Client-side counterpart of the server SecureChannel:
/// 1) connect to wss://server/ws
/// 2) receive channel_hello (server X25519 public key)
/// 3) generate ephemeral X25519 key, derive session key, send channel_ready + JWT
/// 4) all further frames are AES-256-GCM envelopes
/// </summary>
public sealed class SecureClientChannel : IDisposable
{
    private readonly ClientWebSocket _webSocket = new();
    private readonly EcdhKeyAgreement _local = new();
    private SecureChannel? _channel;

    public bool IsConnected => _webSocket.State == WebSocketState.Open;
    public bool IsEncrypted => _channel is { IsEncrypted: true };

    public async Task ConnectAsync(Uri serverUrl, CancellationToken ct = default)
    {
        await _webSocket.ConnectAsync(serverUrl, ct).ConfigureAwait(false);

        // 1) receive server hello
        string hello = await ReceiveRawAsync(ct);
        using var helloDoc = JsonDocument.Parse(hello);
        if (helloDoc.RootElement.GetProperty("type").GetString() != "channel_hello")
            throw new InvalidOperationException("Expected channel_hello");
        byte[] serverKey = Convert.FromBase64String(helloDoc.RootElement.GetProperty("server_key").GetString()!);

        // 2) establish session key and reply
        _channel = new SecureChannel();
        _channel.Establish(serverKey);

        var ready = new
        {
            type = "channel_ready",
            client_key = Convert.ToBase64String(_local.GetPublicKey())
        };
        await SendRawAsync(JsonSerializer.Serialize(ready), ct);
    }

    public async Task AuthenticateAsync(string jwt, CancellationToken ct = default)
    {
        if (_channel is null) throw new InvalidOperationException("Channel not established");
        await SendFrameAsync(new { type = "auth", jwt }, ct);
        string? envelope = await ReceiveRawAsync(ct);
        if (envelope is null) throw new InvalidOperationException("Server closed during auth");
        string json = _channel.Decrypt(envelope);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.GetProperty("type").GetString() != "channel_established")
            throw new InvalidOperationException("Secure channel not established");
    }

    public async Task<TResponse?> SendRequestAsync<TResponse>(object request, CancellationToken ct = default)
    {
        if (_channel is null) throw new InvalidOperationException("Channel not established");
        await SendFrameAsync(request, ct);
        string? envelope = await ReceiveRawAsync(ct);
        if (envelope is null) return default;
        string json = _channel.Decrypt(envelope);
        return JsonSerializer.Deserialize<TResponse>(json);
    }

    public async IAsyncEnumerable<string> ReceiveEventsAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        while (_webSocket.State == WebSocketState.Open)
        {
            string? envelope = await ReceiveRawAsync(ct);
            if (envelope is null) break;
            string json = _channel is null ? envelope : _channel.Decrypt(envelope);
            yield return json;
        }
    }

    private async Task<string?> ReceiveRawAsync(CancellationToken ct)
    {
        using var ms = new MemoryStream();
        var buffer = new byte[8192];
        WebSocketReceiveResult result;
        do
        {
            result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private Task SendRawAsync(string text, CancellationToken ct)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        return _webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    private Task SendFrameAsync(object message, CancellationToken ct)
    {
        string json = JsonSerializer.Serialize(message);
        string envelope = _channel is null ? json : _channel.Encrypt(json);
        return SendRawAsync(envelope, ct);
    }

    public void Dispose()
    {
        _webSocket.Dispose();
        _channel?.Dispose();
        _local.Dispose();
    }
}
