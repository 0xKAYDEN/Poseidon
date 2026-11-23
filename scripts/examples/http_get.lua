-- Example Poseidon node script: fetch a JSON resource over HTTP.
-- Invoked as:  return { run = function(context) ... end }
-- Globals available: http, db, fs, crypto, flow, mail, ai

return {
  run = function(context)
    local inputs = context.inputs or {}
    local url = inputs.url or "https://api.example.com/items"

    local response = http.get(url)
    if response.status_code ~= 200 then
      error("HTTP request failed with status " .. tostring(response.status_code))
    end

    flow.log("GET " .. url .. " -> " .. tostring(response.status_code) .. " (" .. #response.body .. " bytes)")

    -- Try to parse the body as JSON; hand the raw text through either way.
    local body = response.body

    return {
      status_code = response.status_code,
      body = body,
      fetched_at = os.date and os.date("!%Y-%m-%dT%H:%M:%SZ") or nil
    }
  end
}
