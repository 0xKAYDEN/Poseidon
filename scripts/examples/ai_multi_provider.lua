-- Route prompts across multiple AI providers (OpenAI, Anthropic, Gemini, Groq, Ollama, etc.)
-- with automatic fallback when a primary provider errors or is unavailable.

return {
  run = function(context)
    local inputs = context.inputs or {}
    local prompt = inputs.prompt or "Explain event-driven workflow automation in two bullet points."
    local primary = inputs.primary or "anthropic"
    local fallback = inputs.fallback or "openai"

    local available = ai.providers()
    flow.log("Registered AI providers: " .. tostring(#available))

    local res = ai.chat({
      provider = primary,
      system = "You are a concise engineering assistant.",
      prompt = prompt,
      temperature = 0.4,
      max_tokens = 250
    })

    if not res.ok then
      flow.log("Primary provider failed (" .. tostring(res.error) .. "), falling back to " .. fallback)
      res = ai.chat({
        provider = fallback,
        prompt = prompt,
        temperature = 0.4,
        max_tokens = 250
      })
    end

    return {
      provider = res.provider,
      model = res.model,
      stub = res.stub,
      latency_ms = res.latency_ms,
      answer = res.content
    }
  end
}
