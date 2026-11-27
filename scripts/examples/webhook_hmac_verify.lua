-- Verify incoming webhook HMAC-SHA256 signatures and deduplicate events with kv.*.

return {
  run = function(context)
    local inputs = context.inputs or {}
    local secret = (context.secrets and context.secrets.webhook_secret and context.secrets.webhook_secret.value)
      or "poseidon-dev-secret"
    local payloadObj = inputs.payload or { event_id = "evt_" .. crypto.uuid(), action = "order.paid", amount = 49.99 }
    local rawBody = inputs.raw_body or json.encode(payloadObj)
    local expectedSig = crypto.hmac_sha256(rawBody, secret)
    local providedSig = inputs.signature or expectedSig

    local valid = crypto.constant_time_equals(providedSig, expectedSig)
    if not valid then
      error("Invalid webhook signature")
    end

    local eventId = tostring(payloadObj.event_id or crypto.sha256(rawBody))
    local dedupKey = "webhook:seen:" .. eventId
    if kv.get(dedupKey) then
      flow.log("Duplicate webhook ignored: " .. eventId)
      return { accepted = false, duplicate = true, event_id = eventId }
    end

    kv.set(dedupKey, { seen_at = flow.now(), action = payloadObj.action }, 3600)
    flow.emit("webhook_verified", { event_id = eventId, action = payloadObj.action })
    flow.log("Verified and recorded webhook event " .. eventId)

    return {
      accepted = true,
      duplicate = false,
      event_id = eventId,
      signature = expectedSig
    }
  end
}
