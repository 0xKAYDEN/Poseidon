-- Maintain persistent counters and incremental cursors across executions via kv.*.

return {
  run = function(context)
    local counterKey = "demo:run_counter"
    local prevCount = tonumber(kv.get(counterKey) or 0)
    local nextCount = prevCount + 1

    kv.set(counterKey, nextCount)
    kv.set("demo:last_run", {
      run_number = nextCount,
      timestamp = flow.now(),
      unix_ms = flow.unix_ms(),
      node = context.node.name
    }, 86400)

    local allDemoKeys = kv.list("demo:")
    flow.log("Persistent run counter = " .. tostring(nextCount) .. " (" .. tostring(#allDemoKeys) .. " keys)")

    return {
      run_number = nextCount,
      keys = allDemoKeys,
      last_run = kv.get("demo:last_run")
    }
  end
}
