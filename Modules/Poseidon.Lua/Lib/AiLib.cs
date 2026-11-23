using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using NLua;

namespace Poseidon.Lua.Lib;

/// <summary>
/// AI library exposed to Lua as the global `ai` table:
///   local reply = ai.chat({ model = "gpt-4o-mini", messages = {
///       { role = "system", content = "You are a helpful assistant." },
///       { role = "user", content = "Summarize: " .. flow.get("text") } } })
/// Returns: { content = string, model = string }
///
/// MVP behavior: if POSEIDON_AI_API_KEY is set, calls an OpenAI-compatible
/// /chat/completions endpoint (POSEIDON_AI_URL, default https://api.openai.com/v1/chat/completions).
/// Otherwise returns a deterministic stub so scripts can be developed without a key.
/// </summary>
public sealed class AiLib : LuaLib
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly Lua _lua;

    public AiLib(Lua lua)
    {
        _lua = lua ?? throw new ArgumentNullException(nameof(lua));
    }

    public override string Name => "ai";

    public override void Register(LuaEngine engine, Lua lua)
    {
        lua["ai"] = new Api(this);
    }

    public sealed class Api
    {
        private readonly AiLib _lib;
        public Api(AiLib lib) => _lib = lib;

        public LuaTable Chat(LuaTable? request)
        {
            if (request is null) throw new ArgumentNullException(nameof(request));

            string model = request["model"]?.ToString() ?? "stub";
            LuaTable? messages = request["messages"] as LuaTable;

            string apiKey = Environment.GetEnvironmentVariable("POSEIDON_AI_API_KEY") ?? string.Empty;
            string apiUrl = Environment.GetEnvironmentVariable("POSEIDON_AI_URL")
                ?? "https://api.openai.com/v1/chat/completions";

            if (string.IsNullOrEmpty(apiKey))
            {
                string prompt = messages is null ? "" : JoinMessages(messages);
                return MakeResponse(model, $"[stub] I would have answered: {prompt}");
            }

            try
            {
                using var httpReq = new HttpRequestMessage(HttpMethod.Post, apiUrl);
                httpReq.Headers.Add("Authorization", "Bearer " + apiKey);
                var payload = new
                {
                    model,
                    messages = MessagesToArray(messages),
                    temperature = 0.7,
                    max_tokens = 500
                };
                httpReq.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

                using var resp = Client.SendAsync(httpReq).GetAwaiter().GetResult();
                string body = resp.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? string.Empty;
                if (!resp.IsSuccessStatusCode)
                {
                    return MakeResponse(model, "[ai error] HTTP " + (int)resp.StatusCode + " " + body);
                }

                using var doc = JsonDocument.Parse(body);
                string content = doc.RootElement
                    .GetProperty("choices")[0]
                    .GetProperty("message")
                    .GetProperty("content")
                    .GetString() ?? string.Empty;
                string usedModel = doc.RootElement.GetProperty("model").GetString() ?? model;
                return MakeResponse(usedModel, content);
            }
            catch (Exception ex)
            {
                return MakeResponse(model, "[ai exception] " + ex.Message);
            }
        }

        private static string JoinMessages(LuaTable messages)
        {
            var parts = new StringBuilder();
            foreach (var key in messages.Keys)
            {
                if (messages[key] is LuaTable m)
                {
                    string role = m["role"]?.ToString() ?? "?";
                    string content = m["content"]?.ToString() ?? string.Empty;
                    parts.Append($"{role}: {content}\n");
                }
            }
            return parts.ToString();
        }

        private static object?[] MessagesToArray(LuaTable? messages)
        {
            var result = new List<object?>();
            if (messages is null) return result.ToArray();
            foreach (var key in messages.Keys)
            {
                if (messages[key] is LuaTable m)
                {
                    result.Add(new
                    {
                        role = m["role"]?.ToString() ?? "user",
                        content = m["content"]?.ToString() ?? string.Empty
                    });
                }
            }
            return result.ToArray();
        }

        private LuaTable MakeResponse(string model, string content)
        {
            LuaTable t = _lib._lua.NewTable();
            t["content"] = content;
            t["model"] = model;
            return t;
        }
    }
}
