using System.Collections.Concurrent;
using Poseidon.Cryptography.Crypto;

namespace Poseidon.Services;

/// <summary>
/// Tracks active client WebSocket sessions and their negotiated secure channels.
/// </summary>
public sealed class SessionManager
{
    private readonly ConcurrentDictionary<string, SecureChannel> _channels = new();

    public string Add(SecureChannel channel)
    {
        string id = Guid.NewGuid().ToString();
        _channels[id] = channel;
        return id;
    }

    public bool TryGet(string id, out SecureChannel? channel) => _channels.TryGetValue(id, out channel);

    public bool Remove(string id) => _channels.TryRemove(id, out var _);

    public int Count => _channels.Count;
}
