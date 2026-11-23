-- Example Poseidon node script: summarize text using the configured AI provider.
-- Inputs expected: { text = "..." }
-- Falls back to a stub answer when POSEIDON_AI_API_KEY is not configured.

return {
  run = function(context)
    local inputs = context.inputs or {}
    local text = inputs.text or ""

    local reply = ai.chat({
      model = "gpt-4o-mini",
      messages = {
        { role = "system", content = "You are a helpful assistant that summarizes text concisely." },
        { role = "user", content = "Summarize the following:\n\n" .. text }
      }
    })

    flow.log("AI summary: " .. tostring(#reply.content or "") .. " chars")

    return {
      summary = reply.content or "",
      model = reply.model or "stub"
    }
  end
}
