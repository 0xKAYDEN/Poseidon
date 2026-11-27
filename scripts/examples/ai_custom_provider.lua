-- Call a saved custom AI provider by slug OR pass an inline custom HTTP/JSON AI endpoint.
-- Useful for self-hosted vLLM, LiteLLM, LM Studio, Ollama, or internal corporate AI gateways.

return {
  run = function(context)
    local inputs = context.inputs or {}
    local useInline = inputs.inline == true

    local reply
    if useInline then
      local secret = context.secrets and context.secrets.custom_ai_key and context.secrets.custom_ai_key.value
      reply = ai.chat({
        base_url = inputs.base_url or "http://localhost:11434",
        api_format = inputs.api_format or "ollama",
        api_key = secret,
        model = inputs.model or "llama3.2",
        headers = { ["X-Poseidon-Workflow"] = tostring(context.node.name) },
        messages = {
          { role = "user", content = inputs.prompt or "Say hello from Poseidon custom provider!" }
        }
      })
    else
      reply = ai.complete(inputs.prompt or "Generate 3 Lua automation tips.", {
        provider = inputs.provider or "ollama",
        temperature = 0.6
      })
    end

    flow.log("Custom AI response from " .. tostring(reply.provider) .. " (" .. tostring(reply.latency_ms) .. "ms)")
    return reply
  end
}
