import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api';
import type {
  ConnectionCategory,
  ConnectionModel,
  ConnectionPreset,
  ConnectionTestResult,
  LogEntry,
  WorkflowModel
} from '../types';

interface ConnectionsPageProps {
  api: ApiClient;
  onLog: (level: LogEntry['level'], message: string) => void;
}

interface ExtraSecretRow {
  id: string;
  key: string;
  value: string;
  hasExisting: boolean;
  masked?: string;
}

const FALLBACK_PRESETS: ConnectionPreset[] = [
  {
    category: 'telegram',
    name: 'telegram_bot_token',
    label: 'Telegram Bot',
    description: 'Store your @BotFather token, webhook secret, and allowed chat IDs for Telegram bots & alerts.',
    defaultEndpointUrl: 'https://api.telegram.org',
    endpointLabel: 'Telegram Bot API Base URL',
    endpointPlaceholder: 'https://api.telegram.org',
    tokenLabel: 'Bot Token (@BotFather)',
    tokenPlaceholder: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    showWebhookSecret: true,
    webhookSecretLabel: 'Webhook Secret Token (X-Telegram-Bot-Api-Secret-Token)',
    defaultHeaderName: '',
    docsHint: 'Used automatically by Telegram AI Chat Bot or via connections.token("telegram_bot_token").'
  },
  {
    category: 'webhook',
    name: 'custom_webhook',
    label: 'Webhook Endpoint',
    description: 'Save any inbound/outbound webhook URL plus optional signing secret or auth header.',
    defaultEndpointUrl: '',
    endpointLabel: 'Webhook URL',
    endpointPlaceholder: 'https://example.com/webhooks/poseidon',
    tokenLabel: 'Bearer / Auth Token (Optional)',
    tokenPlaceholder: 'Optional bearer token sent with webhook calls',
    showWebhookSecret: true,
    webhookSecretLabel: 'Webhook Signing Secret (HMAC / Verification)',
    defaultHeaderName: 'X-Webhook-Secret',
    docsHint: 'Use notify.webhook(connections.url("custom_webhook"), payload, conn.headers).'
  },
  {
    category: 'slack',
    name: 'slack_webhook',
    label: 'Slack Webhook / Bot',
    description: 'Save a Slack Incoming Webhook URL or Bot User OAuth Token (xoxb-...).',
    defaultEndpointUrl: '',
    endpointLabel: 'Slack Webhook URL',
    endpointPlaceholder: 'https://hooks.slack.com/services/T000/B000/XXXX',
    tokenLabel: 'Slack Bot Token (Optional xoxb-...)',
    tokenPlaceholder: 'xoxb-...',
    showWebhookSecret: true,
    webhookSecretLabel: 'Slack Signing Secret (Optional)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Use notify.slack(connections.url("slack_webhook"), "Deployment succeeded!").'
  },
  {
    category: 'discord',
    name: 'discord_webhook',
    label: 'Discord Webhook / Bot',
    description: 'Save a Discord channel webhook URL or Bot token for workflow notifications.',
    defaultEndpointUrl: '',
    endpointLabel: 'Discord Webhook URL',
    endpointPlaceholder: 'https://discord.com/api/webhooks/123456/abcdef',
    tokenLabel: 'Discord Bot Token (Optional)',
    tokenPlaceholder: 'Optional Discord bot token',
    showWebhookSecret: false,
    webhookSecretLabel: 'Secret (Optional)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Use notify.discord(connections.url("discord_webhook"), "Build complete!").'
  },
  {
    category: 'github',
    name: 'github_token',
    label: 'GitHub Token / Webhook',
    description: 'Personal access token (PAT) and optional GitHub webhook HMAC secret.',
    defaultEndpointUrl: 'https://api.github.com',
    endpointLabel: 'GitHub API Base URL',
    endpointPlaceholder: 'https://api.github.com',
    tokenLabel: 'GitHub Personal Access Token',
    tokenPlaceholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    showWebhookSecret: true,
    webhookSecretLabel: 'GitHub Webhook Secret (X-Hub-Signature-256)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Use http.get(connections.url("github_token") .. "/user", connections.get("github_token").headers).'
  },
  {
    category: 'api_token',
    name: 'api_token',
    label: 'API Key / Bearer Token',
    description: 'Store any third-party REST API token, base URL, and custom auth header.',
    defaultEndpointUrl: '',
    endpointLabel: 'API Base URL (Optional)',
    endpointPlaceholder: 'https://api.service.com/v1',
    tokenLabel: 'API Key / Bearer Token',
    tokenPlaceholder: 'sk_live_...',
    showWebhookSecret: false,
    webhookSecretLabel: 'Secondary Secret (Optional)',
    defaultHeaderName: 'Authorization',
    docsHint: 'Read in any Lua script with connections.token("api_token") or context.secrets.api_token.value.'
  },
  {
    category: 'custom',
    name: 'my_connection',
    label: 'Custom Connection',
    description: 'Flexible encrypted connection with token, endpoint URL, webhook secret, headers, and custom key-value secrets.',
    defaultEndpointUrl: '',
    endpointLabel: 'Endpoint / Webhook URL (Optional)',
    endpointPlaceholder: 'https://...',
    tokenLabel: 'Primary Token / Secret',
    tokenPlaceholder: 'Token or secret value',
    showWebhookSecret: true,
    webhookSecretLabel: 'Webhook / Signing Secret (Optional)',
    defaultHeaderName: 'X-API-Key',
    docsHint: 'Access all fields via connections.get("my_connection") or context.secrets["my_connection"].'
  }
];

function buildLuaSnippet(category: ConnectionCategory, name: string): string {
  const safeName = name.trim() || 'my_connection';
  if (category === 'telegram') {
    return `return {
  run = function(context)
    -- Reads your saved Telegram connection "${safeName}"
    local tg = connections.get("${safeName}") -- or connections.find("telegram")
    local botToken = (tg and tg.token) or connections.token("${safeName}")
    local apiBase = (tg and tg.url and tg.url ~= "" and tg.url) or "https://api.telegram.org"

    local resp = http.post(apiBase .. "/bot" .. botToken .. "/sendMessage", {
      chat_id = (context.inputs and context.inputs.chat_id) or 1001,
      text = "Hello from Poseidon!"
    })
    return { ok = resp.ok, status = resp.status_code, body = resp.json }
  end
}`;
  }
  if (category === 'slack') {
    return `return {
  run = function(context)
    local url = connections.url("${safeName}")
    local res = notify.slack(url, "Poseidon workflow alert at " .. flow.now())
    return { ok = res.ok, status = res.status_code }
  end
}`;
  }
  if (category === 'discord') {
    return `return {
  run = function(context)
    local url = connections.url("${safeName}")
    local res = notify.discord(url, "Poseidon workflow alert at " .. flow.now())
    return { ok = res.ok, status = res.status_code }
  end
}`;
  }
  if (category === 'webhook') {
    return `return {
  run = function(context)
    local hook = connections.get("${safeName}")
    local res = notify.webhook(hook.url, {
      event = "poseidon.run",
      at = flow.now()
    }, hook.headers)
    return { ok = res.ok, status = res.status_code }
  end
}`;
  }
  return `return {
  run = function(context)
    -- Access "${safeName}" in any Lua script or workflow node
    local conn = connections.get("${safeName}")
    local token = connections.token("${safeName}")
    -- Also available in context.secrets["${safeName}"].value
    return {
      has_token = token ~= nil and token ~= "",
      url = conn and conn.url or nil
    }
  end
}`;
}

export const ConnectionsPage: React.FC<ConnectionsPageProps> = ({ api, onLog }) => {
  const [presets, setPresets] = useState<ConnectionPreset[]>(FALLBACK_PRESETS);
  const [connections, setConnections] = useState<ConnectionModel[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  // Form fields
  const [category, setCategory] = useState<ConnectionCategory>('telegram');
  const [name, setName] = useState<string>('telegram_bot_token');
  const [label, setLabel] = useState<string>('Telegram Bot');
  const [description, setDescription] = useState<string>('');
  const [endpointUrl, setEndpointUrl] = useState<string>('https://api.telegram.org');
  const [tokenInput, setTokenInput] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [clearToken, setClearToken] = useState<boolean>(false);
  const [webhookSecretInput, setWebhookSecretInput] = useState<string>('');
  const [showWebhookSecret, setShowWebhookSecret] = useState<boolean>(false);
  const [clearWebhookSecret, setClearWebhookSecret] = useState<boolean>(false);
  const [headerName, setHeaderName] = useState<string>('');
  const [headerValueInput, setHeaderValueInput] = useState<string>('');
  const [showHeaderValue, setShowHeaderValue] = useState<boolean>(false);
  const [clearHeaderValue, setClearHeaderValue] = useState<boolean>(false);
  const [allowedChats, setAllowedChats] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [extraRows, setExtraRows] = useState<ExtraSecretRow[]>([]);

  // Telegram webhook tools
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [webhookStatusText, setWebhookStatusText] = useState<string | null>(null);

  const activePreset = useMemo(
    () => presets.find(p => p.category === category) ?? presets[presets.length - 1] ?? FALLBACK_PRESETS[0],
    [presets, category]
  );

  const selectedConnection = useMemo(
    () => (!isCreating && selectedId ? connections.find(c => c.id === selectedId) ?? null : null),
    [connections, isCreating, selectedId]
  );

  const telegramBotWorkflow = useMemo(
    () =>
      workflows.find(w => w.id === Number(selectedWorkflowId)) ??
      workflows.find(w => w.name.toLowerCase().includes('telegram')) ??
      null,
    [workflows, selectedWorkflowId]
  );

  const isTelegramPollingActive = Boolean(
    telegramBotWorkflow &&
      telegramBotWorkflow.is_active &&
      telegramBotWorkflow.trigger_type === 'schedule'
  );

  const startNewFromPreset = useCallback(
    (cat: ConnectionCategory, presetList: ConnectionPreset[] = presets) => {
      const p = presetList.find(item => item.category === cat) ?? presetList[0] ?? FALLBACK_PRESETS[0];
      setIsCreating(true);
      setSelectedId(null);
      setCategory(p.category);
      setName(p.name);
      setLabel(p.label);
      setDescription('');
      setEndpointUrl(p.defaultEndpointUrl);
      setTokenInput('');
      setShowToken(false);
      setClearToken(false);
      setWebhookSecretInput('');
      setShowWebhookSecret(false);
      setClearWebhookSecret(false);
      setHeaderName(p.defaultHeaderName);
      setHeaderValueInput('');
      setShowHeaderValue(false);
      setClearHeaderValue(false);
      setAllowedChats('');
      setEnabled(true);
      setExtraRows([]);
      setError(null);
      setFeedback(null);
      setTestResult(null);
      setWebhookStatusText(null);
    },
    [presets]
  );

  const hydrateConnection = useCallback((conn: ConnectionModel) => {
    setIsCreating(false);
    setSelectedId(conn.id);
    setCategory(conn.category);
    setName(conn.name);
    setLabel(conn.label);
    setDescription(conn.description);
    setEndpointUrl(conn.endpointUrl);
    setTokenInput('');
    setShowToken(false);
    setClearToken(false);
    setWebhookSecretInput('');
    setShowWebhookSecret(false);
    setClearWebhookSecret(false);
    setHeaderName(conn.headerName);
    setHeaderValueInput('');
    setShowHeaderValue(false);
    setClearHeaderValue(false);
    setAllowedChats(conn.metadata?.allowed_chat_ids ?? '');
    setEnabled(conn.enabled);
    setExtraRows(
      conn.extraKeys.map((k, idx) => ({
        id: `ext_${idx}_${k}`,
        key: k,
        value: '',
        hasExisting: true,
        masked: conn.extraMasked[k] ?? '••••'
      }))
    );
    setError(null);
    setFeedback(null);
    setTestResult(null);
    setWebhookStatusText(null);
  }, []);

  const loadData = useCallback(
    async (preferSelectId?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const [presetRes, connRes, wfRes] = await Promise.allSettled([
          api.getConnectionPresets(),
          api.getConnections(),
          api.getWorkflows()
        ]);

        let activePresets = FALLBACK_PRESETS;
        if (presetRes.status === 'fulfilled' && presetRes.value.length > 0) {
          activePresets = presetRes.value;
          setPresets(activePresets);
        }

        if (wfRes.status === 'fulfilled') {
          setWorkflows(wfRes.value);
          const tgWf = wfRes.value.find(w => w.name.toLowerCase().includes('telegram')) ?? wfRes.value[0];
          if (tgWf && !selectedWorkflowId) {
            setSelectedWorkflowId(String(tgWf.id));
          }
        }

        if (connRes.status === 'fulfilled') {
          const list = connRes.value;
          setConnections(list);
          if (preferSelectId) {
            const match = list.find(c => c.id === preferSelectId || c.name === preferSelectId);
            if (match) {
              hydrateConnection(match);
              return;
            }
          }
          if (list.length > 0 && !isCreating && selectedId) {
            const current = list.find(c => c.id === selectedId);
            if (current) {
              hydrateConnection(current);
              return;
            }
          }
          if (list.length > 0 && preferSelectId === undefined && isCreating && !selectedId) {
            hydrateConnection(list[0]);
          } else if (list.length === 0) {
            startNewFromPreset('telegram', activePresets);
          }
        } else {
          setError((connRes.reason as Error)?.message || 'Failed to load connections');
        }
      } finally {
        setLoading(false);
      }
    },
    [api, hydrateConnection, isCreating, selectedId, selectedWorkflowId, startNewFromPreset]
  );

  useEffect(() => {
    void loadData();
  }, []);

  const handleCategoryChange = (nextCat: ConnectionCategory) => {
    const prevPreset = presets.find(p => p.category === category);
    const nextPreset = presets.find(p => p.category === nextCat) ?? FALLBACK_PRESETS[0];
    setCategory(nextCat);
    if (isCreating) {
      if (!name.trim() || (prevPreset && name === prevPreset.name)) {
        setName(nextPreset.name);
      }
      if (!label.trim() || (prevPreset && label === prevPreset.label)) {
        setLabel(nextPreset.label);
      }
      if (!endpointUrl.trim() || (prevPreset && endpointUrl === prevPreset.defaultEndpointUrl)) {
        setEndpointUrl(nextPreset.defaultEndpointUrl);
      }
      if (!headerName.trim() || (prevPreset && headerName === prevPreset.defaultHeaderName)) {
        setHeaderName(nextPreset.defaultHeaderName);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    if (!name.trim()) {
      setError('Script key name is required.');
      return;
    }

    const extra: Record<string, string> = {};
    const keepExtraKeys: string[] = [];
    for (const row of extraRows) {
      const k = row.key.trim();
      if (!k) continue;
      if (row.value.trim()) {
        extra[k] = row.value.trim();
      } else if (row.hasExisting) {
        keepExtraKeys.push(k);
      }
    }

    const metadata: Record<string, string> = {};
    if (allowedChats.trim()) {
      metadata.allowed_chat_ids = allowedChats.trim();
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        label: label.trim() || name.trim(),
        category,
        description: description.trim(),
        endpointUrl: endpointUrl.trim(),
        headerName: headerName.trim(),
        token: tokenInput.trim() || undefined,
        clearToken,
        webhookSecret: webhookSecretInput.trim() || undefined,
        clearWebhookSecret,
        headerValue: headerValueInput.trim() || undefined,
        clearHeaderValue,
        extra,
        keepExtraKeys,
        metadata,
        enabled
      };

      const saved =
        !isCreating && selectedConnection
          ? await api.updateConnection(selectedConnection.id, payload)
          : await api.saveConnection(payload);

      onLog('success', `Saved connection "${saved.name}" (${saved.category}).`);
      await loadData(saved.id);
      setFeedback(`Saved "${saved.name}". Ready to use in any script via connections.get("${saved.name}") or context.secrets["${saved.name}"].`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedConnection) return;
    setError(null);
    setFeedback(null);
    try {
      await api.deleteConnection(selectedConnection.id);
      onLog('info', `Deleted connection "${selectedConnection.name}".`);
      const remaining = connections.filter(c => c.id !== selectedConnection.id);
      setConnections(remaining);
      if (remaining.length > 0) {
        hydrateConnection(remaining[0]);
      } else {
        startNewFromPreset('telegram');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTest = async (sendPing = false) => {
    if (!selectedConnection) return;
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await api.testConnection(selectedConnection.id, { sendPing });
      setTestResult(res);
      onLog(res.ok ? 'success' : 'error', `Connection test [${selectedConnection.name}]: ${res.message}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleCheckTelegramWebhook = async () => {
    if (!selectedConnection) return;
    setTesting(true);
    setWebhookStatusText(null);
    setError(null);
    try {
      const res = await api.getTelegramWebhookInfo(selectedConnection.id);
      setWebhookStatusText(res.message);
      onLog(res.ok ? 'info' : 'error', res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleSetTelegramWebhook = async (webhookUrl: string) => {
    if (!selectedConnection) return;
    setTesting(true);
    setWebhookStatusText(null);
    setError(null);
    try {
      const res = await api.setTelegramWebhook(selectedConnection.id, webhookUrl);
      setWebhookStatusText(res.message);
      onLog(res.ok ? 'success' : 'error', res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const runTelegramPollAndShowResult = async (wfId: number) => {
    const started = await api.executeWorkflow(wfId, {});
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      const details = await api.getExecutionDetails(started.executionId);
      if (details.status !== 'queued' && details.status !== 'running') {
        if (details.status === 'completed') {
          const stepOut = details.steps?.[0]?.output_json ?? details.output_json ?? '{}';
          setWebhookStatusText(`Poll #${started.executionId} completed: ${stepOut}`);
          onLog('success', `Telegram poll #${started.executionId}: ${stepOut}`);
        } else {
          const stepErr = details.steps?.[0]?.error || details.error || 'Execution failed';
          setError(`Telegram poll #${started.executionId} failed: ${stepErr}`);
          onLog('error', `Telegram poll #${started.executionId} failed: ${stepErr}`);
        }
        return;
      }
    }
    setWebhookStatusText(`Poll #${started.executionId} started (check Studio/Scripts logs).`);
  };

  const handleStartTelegramPolling = async () => {
    if (!telegramBotWorkflow) return;
    setTesting(true);
    setError(null);
    setWebhookStatusText(null);
    try {
      await api.updateWorkflow(telegramBotWorkflow.id, {
        trigger_type: 'schedule',
        schedule_seconds: 5,
        is_active: true
      });
      const wfList = await api.getWorkflows();
      setWorkflows(wfList);
      setFeedback(`Live Telegram polling enabled for "${telegramBotWorkflow.name}" (#${telegramBotWorkflow.id}) every 5 seconds.`);
      onLog('success', `Enabled 5s scheduled polling on "${telegramBotWorkflow.name}" (#${telegramBotWorkflow.id}).`);
      await runTelegramPollAndShowResult(telegramBotWorkflow.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleStopTelegramPolling = async () => {
    if (!telegramBotWorkflow) return;
    setTesting(true);
    setError(null);
    try {
      await api.updateWorkflow(telegramBotWorkflow.id, {
        trigger_type: 'manual',
        schedule_seconds: null
      });
      const wfList = await api.getWorkflows();
      setWorkflows(wfList);
      setWebhookStatusText('Live polling stopped (switched workflow back to Manual trigger).');
      onLog('info', `Stopped scheduled polling on "${telegramBotWorkflow.name}" (#${telegramBotWorkflow.id}).`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handlePollTelegramOnce = async () => {
    if (!telegramBotWorkflow) return;
    setTesting(true);
    setError(null);
    setWebhookStatusText(null);
    try {
      await runTelegramPollAndShowResult(telegramBotWorkflow.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleRestoreTelegramScript = async () => {
    if (!telegramBotWorkflow) return;
    setTesting(true);
    setError(null);
    try {
      const templates = await api.getScripts();
      const tpl = templates.find(t => t.name === 'telegram_ai_bot.lua');
      if (!tpl) {
        setError('Built-in telegram_ai_bot.lua template not found.');
        return;
      }
      await api.updateWorkflow(telegramBotWorkflow.id, {
        mode: 'code',
        nodes: [
          {
            client_id: telegramBotWorkflow.nodes[0]?.client_id || 'tg1',
            type: 'code',
            name: 'Telegram AI Bot',
            script: tpl.content,
            x: 220,
            y: 160
          }
        ],
        edges: []
      });
      const wfList = await api.getWorkflows();
      setWorkflows(wfList);
      setFeedback(`Restored clean Telegram AI Bot script on "${telegramBotWorkflow.name}" (#${telegramBotWorkflow.id}).`);
      onLog('success', `Restored telegram_ai_bot.lua on workflow #${telegramBotWorkflow.id}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleAddExtraRow = () => {
    setExtraRows(prev => [
      ...prev,
      { id: `new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, key: '', value: '', hasExisting: false }
    ]);
  };

  const handleCopyText = async (txt: string, desc: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setFeedback(`Copied ${desc} to clipboard.`);
    } catch {
      setFeedback(`${desc}: ${txt}`);
    }
  };

  const poseidonWebhookUrl = useMemo(() => {
    const wfId = selectedWorkflowId || '7';
    return `${window.location.origin}/api/webhooks/${wfId}`;
  }, [selectedWorkflowId]);

  const luaSnippet = useMemo(() => buildLuaSnippet(category, name), [category, name]);

  return (
    <div className="db-layout">
      {/* Left Sidebar: Quick Templates & Saved Connections */}
      <aside className="db-sidebar" style={{ width: '285px' }}>
        <div className="pane-header">
          <span>Connections ({connections.length})</span>
          <button
            type="button"
            className="btn-accent"
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
            onClick={() => startNewFromPreset('telegram')}
          >
            + New
          </button>
        </div>

        <div style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>
            Quick Add Connection
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {presets.map(preset => (
              <button
                key={preset.category}
                type="button"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                className={isCreating && category === preset.category ? 'btn-accent' : ''}
                onClick={() => startNewFromPreset(preset.category)}
              >
                {preset.label.replace(' Endpoint', '').replace(' Webhook / Bot', '').replace(' / Bearer Token', '').replace(' Token / Webhook', '')}
              </button>
            ))}
          </div>
        </div>

        <div className="db-table-list">
          {loading && connections.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px' }}>Loading connections...</div>
          ) : connections.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px', lineHeight: 1.5 }}>
              No connections saved yet. Fill the form on the right to save your Telegram bot token, webhook URL, or API token.
            </div>
          ) : (
            connections.map(conn => {
              const active = !isCreating && selectedId === conn.id;
              return (
                <button
                  key={conn.id}
                  type="button"
                  className={`db-table-item ${active ? 'active' : ''}`}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '3px', padding: '9px 10px' }}
                  onClick={() => hydrateConnection(conn)}
                >
                  <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {conn.label}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: '10px',
                        color: conn.enabled ? 'var(--success)' : 'var(--text-muted)'
                      }}
                    >
                      {conn.category}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {conn.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {conn.hasToken ? `Token: ${conn.maskedToken}` : conn.endpointUrl ? 'URL saved' : 'No secret yet'}
                    {conn.hasWebhookSecret ? ' · Webhook secret' : ''}
                    {!conn.enabled ? ' · Disabled' : ''}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Detail Panel */}
      <main className="page-container" style={{ padding: '20px 26px', gap: '16px' }}>
        <div className="page-header" style={{ paddingBottom: '12px' }}>
          <div>
            <h1 className="page-title">
              {isCreating ? `New ${activePreset.label}` : `Edit Connection: ${selectedConnection?.label ?? name}`}
            </h1>
            <p className="page-subtitle">
              {activePreset.description} Secrets are encrypted at rest with AES-256-GCM and available in every Lua script.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {!isCreating && selectedConnection && (
              <>
                {selectedConnection.category === 'telegram' ? (
                  <>
                    <button type="button" disabled={testing} onClick={() => void handleTest(false)}>
                      {testing ? 'Checking...' : 'Test Bot (getMe)'}
                    </button>
                    <button type="button" disabled={testing} onClick={() => void handleCheckTelegramWebhook()}>
                      Webhook Info
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={testing} onClick={() => void handleTest(false)}>
                      Validate Config
                    </button>
                    {(selectedConnection.endpointUrl || selectedConnection.category === 'github') && (
                      <button type="button" disabled={testing} onClick={() => void handleTest(true)}>
                        {testing ? 'Sending...' : selectedConnection.category === 'github' ? 'Test GitHub Auth' : 'Send Test Ping'}
                      </button>
                    )}
                  </>
                )}
                <button type="button" className="btn-danger" onClick={() => void handleDelete()}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {error && <div className="form-error" style={{ marginBottom: 0 }}>{error}</div>}
        {feedback && (
          <div
            style={{
              background: 'rgba(34, 197, 94, 0.12)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              color: '#86efac',
              padding: '9px 12px',
              borderRadius: '5px',
              fontSize: '12.5px'
            }}
          >
            {feedback}
          </div>
        )}
        {testResult && (
          <div
            style={{
              background: testResult.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${testResult.ok ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.38)'}`,
              color: testResult.ok ? '#86efac' : '#fca5a5',
              padding: '10px 12px',
              borderRadius: '5px',
              fontSize: '12.5px'
            }}
          >
            <strong>{testResult.ok ? 'Connection OK' : 'Test Failed'}:</strong> {testResult.message}{' '}
            <span className="mono" style={{ opacity: 0.75 }}>({testResult.latencyMs}ms)</span>
          </div>
        )}

        <form
          onSubmit={handleSave}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>Connection Type</label>
              <select
                value={category}
                onChange={e => handleCategoryChange(e.target.value as ConnectionCategory)}
              >
                {presets.map(p => (
                  <option key={p.category} value={p.category}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>
                Script Key Name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(for scripts)</span>
              </label>
              <input
                className="mono"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. telegram_bot_token or slack_alerts"
                required
              />
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>Display Label</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Friendly name shown in Connections"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>
                {activePreset.tokenLabel}
                {selectedConnection?.hasToken && !clearToken && (
                  <span className="mono" style={{ marginLeft: '8px', color: 'var(--success)', fontWeight: 400 }}>
                    Saved ({selectedConnection.maskedToken})
                  </span>
                )}
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type={showToken ? 'text' : 'password'}
                  className="mono"
                  style={{ flex: 1 }}
                  value={tokenInput}
                  onChange={e => {
                    setTokenInput(e.target.value);
                    setClearToken(false);
                  }}
                  placeholder={
                    selectedConnection?.hasToken && !clearToken
                      ? 'Leave blank to keep existing encrypted token'
                      : activePreset.tokenPlaceholder
                  }
                />
                <button type="button" onClick={() => setShowToken(v => !v)}>
                  {showToken ? 'Hide' : 'Show'}
                </button>
                {selectedConnection?.hasToken && (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      setTokenInput('');
                      setClearToken(true);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>{activePreset.endpointLabel}</label>
              <input
                className="mono"
                value={endpointUrl}
                onChange={e => setEndpointUrl(e.target.value)}
                placeholder={activePreset.endpointPlaceholder}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
            {(activePreset.showWebhookSecret || category === 'custom') && (
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>
                  {activePreset.webhookSecretLabel}
                  {selectedConnection?.hasWebhookSecret && !clearWebhookSecret && (
                    <span className="mono" style={{ marginLeft: '8px', color: 'var(--success)', fontWeight: 400 }}>
                      Saved ({selectedConnection.maskedWebhookSecret})
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type={showWebhookSecret ? 'text' : 'password'}
                    className="mono"
                    style={{ flex: 1 }}
                    value={webhookSecretInput}
                    onChange={e => {
                      setWebhookSecretInput(e.target.value);
                      setClearWebhookSecret(false);
                    }}
                    placeholder={
                      selectedConnection?.hasWebhookSecret && !clearWebhookSecret
                        ? 'Leave blank to keep existing secret'
                        : 'Optional webhook secret token'
                    }
                  />
                  <button type="button" onClick={() => setShowWebhookSecret(v => !v)}>
                    {showWebhookSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )}

            {category === 'telegram' && (
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Allowed Telegram Chat IDs (Optional, comma-separated)</label>
                <input
                  className="mono"
                  value={allowedChats}
                  onChange={e => setAllowedChats(e.target.value)}
                  placeholder="e.g. 123456789, -100987654321"
                />
              </div>
            )}

            {category !== 'telegram' && (
              <>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Auth Header Name (Optional)</label>
                  <input
                    className="mono"
                    value={headerName}
                    onChange={e => setHeaderName(e.target.value)}
                    placeholder="e.g. Authorization or X-Webhook-Secret"
                  />
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>
                    Auth Header Value (Optional)
                    {selectedConnection?.hasHeaderValue && !clearHeaderValue && (
                      <span className="mono" style={{ marginLeft: '8px', color: 'var(--success)', fontWeight: 400 }}>
                        Saved ({selectedConnection.maskedHeaderValue})
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type={showHeaderValue ? 'text' : 'password'}
                      className="mono"
                      style={{ flex: 1 }}
                      value={headerValueInput}
                      onChange={e => {
                        setHeaderValueInput(e.target.value);
                        setClearHeaderValue(false);
                      }}
                      placeholder={
                        selectedConnection?.hasHeaderValue && !clearHeaderValue
                          ? 'Leave blank to keep existing header value'
                          : 'Overrides token in custom header'
                      }
                    />
                    <button type="button" onClick={() => setShowHeaderValue(v => !v)}>
                      {showHeaderValue ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>Notes / Description (Optional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Where this bot token or webhook is used..."
            />
          </div>

          {/* Extra Encrypted Key-Value Secrets */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Additional Encrypted Key-Value Tokens / Fields (Optional)
              </span>
              <button type="button" style={{ padding: '4px 10px', fontSize: '11.5px' }} onClick={handleAddExtraRow}>
                + Add Field
              </button>
            </div>
            {extraRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {extraRows.map(row => (
                  <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      className="mono"
                      style={{ width: '210px' }}
                      placeholder="key (e.g. chat_id)"
                      value={row.key}
                      onChange={e =>
                        setExtraRows(prev => prev.map(r => (r.id === row.id ? { ...r, key: e.target.value } : r)))
                      }
                    />
                    <input
                      type="password"
                      className="mono"
                      style={{ flex: 1 }}
                      placeholder={row.hasExisting ? `Saved (${row.masked}) — blank keeps current` : 'secret value'}
                      value={row.value}
                      onChange={e =>
                        setExtraRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: e.target.value } : r)))
                      }
                    />
                    <button
                      type="button"
                      className="btn-danger"
                      style={{ padding: '5px 9px', fontSize: '11.5px' }}
                      onClick={() => setExtraRows(prev => prev.filter(r => r.id !== row.id))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              borderTop: '1px solid var(--border)',
              paddingTop: '12px'
            }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              Enabled (available to workflows & Lua scripts)
            </label>

            <div style={{ display: 'flex', gap: '8px' }}>
              {!isCreating && (
                <button type="button" onClick={() => startNewFromPreset(category)}>
                  Create Another
                </button>
              )}
              <button type="submit" className="btn-accent" disabled={saving}>
                {saving ? 'Saving...' : isCreating ? 'Save Connection' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>

        {/* Telegram Webhook & Live Polling Helper */}
        {!isCreating && selectedConnection && selectedConnection.category === 'telegram' && (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ fontSize: '14px', color: '#ffffff' }}>Telegram Bot Live Listener & Webhook Helper</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  When running locally (no public HTTPS URL), enable <strong>Live Polling (5s)</strong> so Poseidon automatically checks Telegram and answers every DM with your default AI provider.
                </p>
              </div>
              {telegramBotWorkflow && (
                <span
                  className="mono"
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: isTelegramPollingActive ? 'var(--success)' : 'var(--text-muted)'
                  }}
                >
                  {isTelegramPollingActive
                    ? `Polling Active (every ${telegramBotWorkflow.schedule_seconds ?? 5}s)`
                    : 'Polling Stopped (Manual)'}
                </span>
              )}
            </div>

            {telegramBotWorkflow && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {!isTelegramPollingActive ? (
                  <button
                    type="button"
                    className="btn-accent"
                    disabled={testing || !selectedConnection.hasToken}
                    onClick={() => void handleStartTelegramPolling()}
                  >
                    Start Live Polling (5s)
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={testing}
                    onClick={() => void handleStopTelegramPolling()}
                  >
                    Stop Live Polling
                  </button>
                )}
                <button
                  type="button"
                  disabled={testing || !selectedConnection.hasToken}
                  onClick={() => void handlePollTelegramOnce()}
                >
                  Poll Now
                </button>
                <button
                  type="button"
                  disabled={testing}
                  onClick={() => void handleRestoreTelegramScript()}
                  title="Reset workflow script back to clean telegram_ai_bot.lua"
                >
                  Restore Default Bot Script
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <select
                value={selectedWorkflowId}
                onChange={e => setSelectedWorkflowId(e.target.value)}
                style={{ minWidth: '220px' }}
              >
                {workflows.map(wf => (
                  <option key={wf.id} value={String(wf.id)}>
                    #{wf.id} — {wf.name}
                  </option>
                ))}
              </select>
              <input className="mono" style={{ flex: 1, minWidth: '240px' }} value={poseidonWebhookUrl} readOnly />
              <button type="button" onClick={() => void handleCopyText(poseidonWebhookUrl, 'Webhook URL')}>
                Copy URL
              </button>
              <button
                type="button"
                disabled={testing || !selectedConnection.hasToken}
                onClick={() => void handleSetTelegramWebhook(poseidonWebhookUrl)}
              >
                Set Telegram Webhook
              </button>
              <button
                type="button"
                disabled={testing || !selectedConnection.hasToken}
                onClick={() => void handleSetTelegramWebhook('')}
              >
                Delete Webhook (Polling)
              </button>
            </div>

            {webhookStatusText && (
              <div className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                {webhookStatusText}
              </div>
            )}
          </div>
        )}

        {/* Lua Usage Snippet */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '14px', color: '#ffffff' }}>Use in Any Lua Script</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {activePreset.docsHint}
              </p>
            </div>
            <button type="button" onClick={() => void handleCopyText(luaSnippet, 'Lua snippet')}>
              Copy Lua Snippet
            </button>
          </div>
          <pre
            className="code-snippet"
            style={{ maxHeight: 'none', margin: 0, fontSize: '12px', lineHeight: 1.55 }}
          >
            {luaSnippet}
          </pre>
        </div>
      </main>
    </div>
  );
};
