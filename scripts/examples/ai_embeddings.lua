-- Compute vector embeddings with ai.embed() and rank documents by cosine similarity.

local function cosine_similarity(a, b)
  local dot, na, nb = 0, 0, 0
  for i = 1, math.min(#a, #b) do
    dot = dot + a[i] * b[i]
    na = na + a[i] * a[i]
    nb = nb + b[i] * b[i]
  end
  if na == 0 or nb == 0 then return 0 end
  return dot / (math.sqrt(na) * math.sqrt(nb))
end

return {
  run = function(context)
    local inputs = context.inputs or {}
    local queryText = inputs.query or "Lua workflow automation with encrypted WebSockets"
    local docs = inputs.docs or {
      "Poseidon executes sandboxed Lua pipelines over X25519 encrypted WebSockets.",
      "How to bake sourdough bread at home.",
      "SQL console and AES-256-GCM secret vault for automation scripts."
    }

    local qRes = ai.embed(queryText, { provider = inputs.provider })
    local dRes = ai.embed(docs, { provider = inputs.provider })

    local scored = {}
    for i, docText in ipairs(docs) do
      local vec = dRes.embeddings[i] or {}
      local sim = cosine_similarity(qRes.embedding, vec)
      table.insert(scored, { index = i, score = tonumber(string.format("%.4f", sim)), text = docText })
    end
    table.sort(scored, function(x, y) return x.score > y.score end)

    flow.log("Ranked " .. tostring(#scored) .. " documents (" .. tostring(qRes.dimensions) .. " dims)")
    return { provider = qRes.provider, stub = qRes.stub, dimensions = qRes.dimensions, ranked = scored }
  end
}
