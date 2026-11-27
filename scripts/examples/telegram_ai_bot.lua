-- Telegram AI Bot for Poseidon
-- Supports BOTH modes automatically:
--   1. Webhook Mode: point Telegram setWebhook -> POST /api/webhooks/<workflow_id>
--      (inputs.message or inputs.edited_message is present)
--   2. Polling Mode: run manually or set trigger = "schedule" (e.g., every 5s)
--      to pull new messages via Telegram getUpdates with persistent kv offset.
--
-- Setup:
--   1. Open the Connections tab -> add a "Telegram Bot" connection with your @BotFather token
--      (or add "telegram_bot_token" in Vault / pass inputs.bot_token / save kv.set("tg:bot_token", "...")).
--   2. Configure your AI provider in the AI Providers tab (OpenAI, Anthropic, Gemini,
--      Groq, Ollama, or a Custom provider). Without an API key, Poseidon uses stub mode.
--   3. Optional test in Studio without Telegram network calls:
--      { "dry_run": true, "message": { "chat": { "id": 1001 }, "text": "Hello AI!" } }

local HISTORY_TTL_SECONDS = 7 * 24 * 3600
local MAX_TELEGRAM_CHARS = 4000

local function readSecret(secrets, key)
  if type(secrets) ~= "table" then return nil end
  local entry = secrets[key]
  if type(entry) == "table" and type(entry.value) == "string" and text.trim(entry.value) ~= "" then
    return text.trim(entry.value)
  elseif type(entry) == "string" and text.trim(entry) ~= "" then
    return text.trim(entry)
  end
  return nil
end

local function parseAllowedSet(raw)
  if raw == nil then return nil end
  local set = {}
  local count = 0
  if type(raw) == "table" then
    for _, v in ipairs(raw) do
      local k = text.trim(tostring(v))
      if k ~= "" then
        set[k] = true
        count = count + 1
      end
    end
  elseif type(raw) == "string" and text.trim(raw) ~= "" then
    for _, part in ipairs(text.split(raw, ",")) do
      local k = text.trim(part)
      if k ~= "" then
        set[k] = true
        count = count + 1
      end
    end
  end
  if count == 0 then return nil end
  return set
end

local function splitChunks(body, maxLen)
  local str = tostring(body or "")
  if str == "" then return { "(empty response)" } end
  if #str <= maxLen then return { str } end

  local chunks = {}
  local idx = 1
  while idx <= #str do
    local limit = math.min(idx + maxLen - 1, #str)
    if limit < #str then
      local slice = string.sub(str, idx, limit)
      local cut = slice:match("^.*()\n") or slice:match("^.*() ")
      if cut and cut > math.floor(maxLen * 0.4) then
        limit = idx + cut - 1
      end
    end
    table.insert(chunks, string.sub(str, idx, limit))
    idx = limit + 1
  end
  return chunks
end

local function tgRequest(apiBase, botToken, methodName, payload)
  local url = apiBase .. "/bot" .. botToken .. "/" .. methodName
  local resp = http.post(url, payload)
  local parsed = resp.json
  if type(parsed) == "table" then
    return resp.status_code, parsed
  end
  return resp.status_code, { ok = false, description = resp.body or ("HTTP " .. tostring(resp.status_code)) }
end

local function sendTelegramText(apiBase, botToken, chatId, bodyText, replyToMsgId, dryRun)
  local chunks = splitChunks(bodyText, MAX_TELEGRAM_CHARS)
  local sentIds = {}

  if dryRun then
    return { ok = true, dry_run = true, chunks = chunks }
  end

  for idx, chunk in ipairs(chunks) do
    local payload = {
      chat_id = chatId,
      text = chunk,
      parse_mode = "Markdown",
      disable_web_page_preview = true
    }
    if idx == 1 and replyToMsgId then
      payload.reply_to_message_id = replyToMsgId
    end

    local status, res = tgRequest(apiBase, botToken, "sendMessage", payload)
    if not res.ok then
      -- Retry as plain text in case Markdown entities in AI code snippets caused HTTP 400
      payload.parse_mode = nil
      status, res = tgRequest(apiBase, botToken, "sendMessage", payload)
    end

    if not res.ok then
      return {
        ok = false,
        status_code = status,
        error = tostring(res.description or "Telegram sendMessage failed"),
        sent_message_ids = sentIds
      }
    end

    if type(res.result) == "table" and res.result.message_id then
      table.insert(sentIds, res.result.message_id)
    end
  end

  return { ok = true, chunks_sent = #chunks, sent_message_ids = sentIds }
end

local function formatProvidersList()
  local list = ai.providers() or {}
  local lines = { "Configured Poseidon AI providers:" }
  for _, p in ipairs(list) do
    if p.enabled ~= false then
      local mark = p.is_default and " [default]" or ""
      local keyStatus = p.has_api_key and "key set" or "stub/no key"
      table.insert(lines, string.format("- %s (%s) — model: %s (%s)%s", tostring(p.id), tostring(p.name), tostring(p.default_model), keyStatus, mark))
    end
  end
  table.insert(lines, "")
  table.insert(lines, "Switch with: /provider <id>  (e.g. /provider openai or /provider custom)")
  return table.concat(lines, "\n")
end

local function processTelegramMessage(msg, ctxCfg)
  if type(msg) ~= "table" or type(msg.chat) ~= "table" or msg.chat.id == nil then
    return { skipped = true, reason = "no chat in update" }
  end

  local chatId = msg.chat.id
  local chatKey = tostring(chatId)
  local userText = text.trim(tostring(msg.text or msg.caption or ""))

  if ctxCfg.allowedSet and not ctxCfg.allowedSet[chatKey] then
    flow.log("Blocked unauthorized Telegram chat_id=" .. chatKey)
    sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, "Unauthorized chat ID (" .. chatKey .. ").", msg.message_id, ctxCfg.dryRun)
    return { chat_id = chatId, blocked = true }
  end

  if userText == "" then
    return { chat_id = chatId, skipped = true, reason = "non-text message" }
  end

  local senderName = "User"
  if type(msg.from) == "table" then
    senderName = tostring(msg.from.username or msg.from.first_name or msg.from.id or "User")
  end

  local historyKey = "tg:history:" .. chatKey
  local providerKey = "tg:provider:" .. chatKey
  local modelKey = "tg:model:" .. chatKey
  local systemKey = "tg:system:" .. chatKey

  local activeProvider = kv.get(providerKey) or ctxCfg.defaultProvider
  local activeModel = kv.get(modelKey) or ctxCfg.defaultModel
  local activeSystem = kv.get(systemKey) or ctxCfg.defaultSystem

  -- Handle Telegram slash commands
  if string.sub(userText, 1, 1) == "/" then
    local rawCmd, rawArg = userText:match("^/(%S+)%s*(.*)$")
    local cmd = rawCmd and string.lower(rawCmd:gsub("@.*$", "")) or ""
    local arg = text.trim(rawArg or "")

    if cmd == "start" or cmd == "help" then
      local helpText = table.concat({
        "Poseidon AI Telegram Bot",
        "",
        "Just send any message to chat with AI (conversation memory is saved per chat).",
        "",
        "Commands:",
        "/help - Show this help message",
        "/status - Show active AI provider, model, and memory turns",
        "/providers - List configured Poseidon AI providers",
        "/provider <id|default> - Switch AI provider for this chat",
        "/model <name|default> - Override AI model for this chat",
        "/system <prompt|default> - Set custom system prompt",
        "/reset - Clear conversation history for this chat"
      }, "\n")
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, helpText, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = helpText, delivery = sendRes }
    elseif cmd == "reset" then
      kv.delete(historyKey)
      local replyMsg = "Conversation memory cleared for this chat."
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, replyMsg, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = replyMsg, delivery = sendRes }
    elseif cmd == "providers" then
      local listText = formatProvidersList()
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, listText, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = listText, delivery = sendRes }
    elseif cmd == "provider" then
      local replyMsg
      if arg == "" then
        replyMsg = "Usage: /provider <id|default>\nCurrent: " .. tostring(activeProvider or "(default)")
      elseif string.lower(arg) == "default" then
        kv.delete(providerKey)
        replyMsg = "Chat provider reset to Poseidon's default."
      else
        local found = nil
        for _, p in ipairs(ai.providers() or {}) do
          if tostring(p.id) == arg then
            found = p
            break
          end
        end
        if not found then
          replyMsg = "Unknown provider '" .. arg .. "'. Run /providers to view valid IDs."
        else
          kv.set(providerKey, arg, HISTORY_TTL_SECONDS)
          replyMsg = "Switched AI provider to: " .. tostring(found.name) .. " (" .. arg .. ")"
        end
      end
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, replyMsg, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = replyMsg, delivery = sendRes }
    elseif cmd == "model" then
      local replyMsg
      if arg == "" then
        replyMsg = "Usage: /model <model-name|default>\nCurrent: " .. tostring(activeModel or "(provider default)")
      elseif string.lower(arg) == "default" then
        kv.delete(modelKey)
        replyMsg = "Chat model reset to provider default."
      else
        kv.set(modelKey, arg, HISTORY_TTL_SECONDS)
        replyMsg = "Switched AI model override to: " .. arg
      end
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, replyMsg, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = replyMsg, delivery = sendRes }
    elseif cmd == "system" then
      local replyMsg
      if arg == "" then
        replyMsg = "Usage: /system <prompt|default>\nCurrent: " .. tostring(activeSystem)
      elseif string.lower(arg) == "default" then
        kv.delete(systemKey)
        replyMsg = "System prompt reset to default."
      else
        kv.set(systemKey, arg, HISTORY_TTL_SECONDS)
        replyMsg = "Updated system prompt for this chat."
      end
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, replyMsg, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = replyMsg, delivery = sendRes }
    elseif cmd == "status" then
      local history = kv.get(historyKey)
      local turns = type(history) == "table" and #history or 0
      local statusMsg = table.concat({
        "Telegram AI Bot Status",
        "Chat ID: " .. chatKey,
        "Provider: " .. tostring(activeProvider or "(default)"),
        "Model: " .. tostring(activeModel or "(provider default)"),
        "Saved turns: " .. tostring(turns) .. " / " .. tostring(ctxCfg.historyLimit)
      }, "\n")
      local sendRes = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, statusMsg, msg.message_id, ctxCfg.dryRun)
      return { chat_id = chatId, command = cmd, reply = statusMsg, delivery = sendRes }
    end
  end

  -- Notify Telegram that bot is typing (best effort)
  if not ctxCfg.dryRun then
    tgRequest(ctxCfg.apiBase, ctxCfg.botToken, "sendChatAction", {
      chat_id = chatId,
      action = "typing"
    })
  end

  -- Load & update conversation history
  local history = kv.get(historyKey)
  if type(history) ~= "table" then history = {} end

  local messages = {
    { role = "system", content = activeSystem }
  }
  for _, m in ipairs(history) do
    if type(m) == "table" and m.role and m.content then
      table.insert(messages, { role = tostring(m.role), content = tostring(m.content) })
    end
  end
  table.insert(messages, { role = "user", content = userText })

  flow.log("Telegram @" .. senderName .. " (" .. chatKey .. "): " .. string.sub(userText, 1, 80))

  local aiRes = ai.chat({
    provider = activeProvider,
    model = activeModel,
    messages = messages,
    temperature = ctxCfg.temperature,
    max_tokens = ctxCfg.maxTokens
  })

  local answer
  if aiRes.ok then
    answer = tostring(aiRes.content or "(empty AI response)")
    table.insert(history, { role = "user", content = userText })
    table.insert(history, { role = "assistant", content = answer })
    while #history > ctxCfg.historyLimit do
      table.remove(history, 1)
    end
    kv.set(historyKey, history, HISTORY_TTL_SECONDS)
  else
    answer = "AI error (" .. tostring(aiRes.provider or "unknown") .. "): " .. tostring(aiRes.error or "request failed")
  end

  local delivery = sendTelegramText(ctxCfg.apiBase, ctxCfg.botToken, chatId, answer, msg.message_id, ctxCfg.dryRun)

  flow.emit("telegram_ai_reply", {
    chat_id = chatId,
    sender = senderName,
    provider = aiRes.provider,
    model = aiRes.model,
    stub = aiRes.stub,
    chars = #answer,
    ok = delivery.ok
  })

  return {
    chat_id = chatId,
    sender = senderName,
    user_text = userText,
    provider = aiRes.provider,
    model = aiRes.model,
    stub = aiRes.stub,
    latency_ms = aiRes.latency_ms,
    reply = answer,
    history_turns = #history,
    delivery = delivery
  }
end

return {
  run = function(context)
    local inputs = context.inputs or {}
    local secrets = context.secrets or {}

    local dryRun = inputs.dry_run == true
    local connName = (type(inputs.connection) == "string" and text.trim(inputs.connection) ~= "" and text.trim(inputs.connection)) or nil
    local tgConn = nil
    if type(connections) == "table" then
      tgConn = (connName and connections.get(connName))
        or connections.get("telegram_bot_token")
        or connections.find("telegram")
    end

    local connToken = (type(tgConn) == "table" and type(tgConn.token) == "string" and text.trim(tgConn.token) ~= "" and text.trim(tgConn.token)) or nil
    local botToken =
      (type(inputs.bot_token) == "string" and text.trim(inputs.bot_token) ~= "" and text.trim(inputs.bot_token))
      or connToken
      or readSecret(secrets, "telegram_bot_token")
      or readSecret(secrets, "TELEGRAM_BOT_TOKEN")
      or kv.get("tg:bot_token")

    if not dryRun and (not botToken or botToken == "") then
      error("Missing Telegram bot token. Save a Telegram Bot in the Connections tab (or Vault 'telegram_bot_token' / inputs.bot_token).")
    end

    -- Optional Telegram webhook secret validation (X-Telegram-Bot-Api-Secret-Token)
    local connWebhookSecret = (type(tgConn) == "table" and type(tgConn.webhook_secret) == "string" and text.trim(tgConn.webhook_secret) ~= "" and text.trim(tgConn.webhook_secret)) or nil
    local expectedWebhookSecret = connWebhookSecret or readSecret(secrets, "telegram_webhook_secret")
    if expectedWebhookSecret and inputs._telegram_secret ~= nil then
      if not crypto.constant_time_equals(tostring(inputs._telegram_secret), expectedWebhookSecret) then
        error("Invalid Telegram webhook secret token")
      end
    end

    local connApiBase = (type(tgConn) == "table" and type(tgConn.url) == "string" and text.trim(tgConn.url) ~= "" and text.trim(tgConn.url)) or nil
    local apiBase = tostring(inputs.telegram_api_base or connApiBase or kv.get("tg:api_base") or "https://api.telegram.org"):gsub("/+$", "")
    local connAllowedChats = (type(tgConn) == "table" and type(tgConn.metadata) == "table" and tgConn.metadata.allowed_chat_ids) or nil
    local allowedRaw = inputs.allowed_chat_ids or connAllowedChats or readSecret(secrets, "telegram_allowed_chats") or kv.get("tg:allowed_chat_ids")

    local cfg = {
      botToken = botToken or "",
      apiBase = apiBase,
      dryRun = dryRun,
      defaultProvider = inputs.provider or kv.get("tg:default_provider") or nil,
      defaultModel = inputs.model or kv.get("tg:default_model") or nil,
      defaultSystem = inputs.system_prompt or kv.get("tg:default_system") or "You are a helpful, concise AI assistant running on Poseidon.",
      historyLimit = tonumber(inputs.history_limit or 12) or 12,
      temperature = tonumber(inputs.temperature or 0.7) or 0.7,
      maxTokens = tonumber(inputs.max_tokens or 1024) or 1024,
      allowedSet = parseAllowedSet(allowedRaw)
    }

    -- Mode A: Webhook or direct single-message invocation
    local directMsg = inputs.message or inputs.edited_message or inputs.channel_post
    if type(directMsg) == "table" then
      local outcome = processTelegramMessage(directMsg, cfg)
      return {
        mode = dryRun and "dry_run" or "webhook",
        update_id = inputs.update_id,
        result = outcome
      }
    end

    if dryRun then
      error("dry_run requires inputs.message = { chat = { id = 1001 }, text = 'Hello!' }")
    end

    -- Mode B: Polling Telegram getUpdates using persistent kv offset
    local offset = kv.get("tg:update_offset")
    local pollTimeout = tonumber(inputs.poll_timeout or 0) or 0
    local url = apiBase .. "/bot" .. botToken .. "/getUpdates?timeout=" .. tostring(pollTimeout)
    if type(offset) == "number" and offset > 0 then
      url = url .. "&offset=" .. tostring(math.floor(offset))
    end

    local resp = http.get(url)
    if not resp.ok or type(resp.json) ~= "table" or not resp.json.ok then
      local errDesc = (type(resp.json) == "table" and resp.json.description) or resp.body or ("HTTP " .. tostring(resp.status_code))
      if resp.status_code == 409 then
        error("Telegram webhook is currently active (HTTP 409). Open Connections -> click 'Delete Webhook (Polling)' to switch to polling mode. (" .. tostring(errDesc) .. ")")
      end
      error("Telegram getUpdates failed: " .. tostring(errDesc))
    end

    local updates = resp.json.result or {}
    local results = {}
    local maxUpdateId = nil

    for _, upd in ipairs(updates) do
      if type(upd) == "table" then
        if type(upd.update_id) == "number" then
          if not maxUpdateId or upd.update_id > maxUpdateId then
            maxUpdateId = upd.update_id
          end
        end
        local updMsg = upd.message or upd.edited_message or upd.channel_post
        if type(updMsg) == "table" then
          local r = processTelegramMessage(updMsg, cfg)
          r.update_id = upd.update_id
          table.insert(results, r)
        end
      end
    end

    if maxUpdateId then
      kv.set("tg:update_offset", maxUpdateId + 1)
    end

    flow.log("Telegram polling processed " .. tostring(#results) .. " message(s)")
    return {
      mode = "polling",
      updates_fetched = #updates,
      processed = #results,
      next_offset = maxUpdateId and (maxUpdateId + 1) or offset,
      results = results
    }
  end
}
