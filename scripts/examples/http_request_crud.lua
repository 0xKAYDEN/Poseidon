-- Unified HTTP client using http.request() with query parameters, JSON body, and headers.

return {
  run = function(context)
    local inputs = context.inputs or {}
    local resp = http.request({
      method = inputs.method or "POST",
      url = inputs.url or "https://jsonplaceholder.typicode.com/posts",
      query = { source = "poseidon", tag = "lua automation" },
      headers = { ["X-Request-Id"] = crypto.uuid() },
      json = {
        title = inputs.title or "Poseidon Automated Entry",
        body = "Sent from Lua http.request at " .. flow.now(),
        userId = 1
      },
      timeout_ms = 10000
    })

    flow.log("HTTP " .. tostring(resp.status_code) .. " received")
    return {
      status_code = resp.status_code,
      parsed = resp.json,
      encoded_tag = encoding.url_encode("lua automation & workflows")
    }
  end
}
