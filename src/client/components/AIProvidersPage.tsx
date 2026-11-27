import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api';
import type {
  AiAuthType,
  AiProtocolFormat,
  AiProviderModel,
  AiProviderPreset,
  LogEntry
} from '../types';

interface AIProvidersPageProps {
  api: ApiClient;
  onLog: (level: LogEntry['level'], message: string) => void;
}

const PROTOCOL_OPTIONS: Array<{ value: AiProtocolFormat; label: string }> = [
  { value: 'openai_compatible', label: 'OpenAI-Compatible (/chat/completions)' },
  { value: 'anthropic', label: 'Anthropic Messages (/messages)' },
  { value: 'gemini', label: 'Google Gemini (:generateContent)' },
  { value: 'ollama', label: 'Ollama Local (/api/chat)' },
  { value: 'azure_openai', label: 'Azure OpenAI (Deployments)' },
  { value: 'cohere', label: 'Cohere v2 (/chat)' },
  { value: 'custom_json', label: 'Custom HTTP JSON Endpoint' }
];

const AUTH_OPTIONS: Array<{ value: AiAuthType; label: string }> = [
  { value: 'bearer', label: 'Bearer Token (Authorization: Bearer ...)' },
  { value: 'x-api-key', label: 'Anthropic Header (x-api-key)' },
  { value: 'api-key', label: 'Azure Header (api-key)' },
  { value: 'x-goog-api-key', label: 'Google Header (x-goog-api-key)' },
  { value: 'header', label: 'Custom Header Name & Prefix' },
  { value: 'query_param', label: 'Query Parameter (?key=...)' },
  { value: 'none', label: 'No Authentication (Local / Open)' }
];

export const AIProvidersPage: React.FC<AIProvidersPageProps> = ({ api, onLog }) => {
  const [providers, setProviders] = useState<AiProviderModel[]>([]);
  const [presets, setPresets] = useState<AiProviderPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string>('openai');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form fields for selected provider
  const [name, setName] = useState('');
  const [apiFormat, setApiFormat] = useState<AiProtocolFormat>('openai_compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [modelsText, setModelsText] = useState('');
  const [authType, setAuthType] = useState<AiAuthType>('bearer');
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [authPrefix, setAuthPrefix] = useState('Bearer ');
  const [apiKeyParamName, setApiKeyParamName] = useState('key');
  const [apiVersion, setApiVersion] = useState('2024-10-21');
  const [responsePath, setResponsePath] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [requiresApiKey, setRequiresApiKey] = useState(true);
  const [customHeadersText, setCustomHeadersText] = useState('{}');
  const [customBodyText, setCustomBodyText] = useState('{}');
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [enabled, setEnabled] = useState(true);

  // Quick Prompt Playground
  const [testPrompt, setTestPrompt] = useState('Summarize what Poseidon Lua automation does in one sentence.');
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    stub: boolean;
    model: string;
    latencyMs: number;
    content: string;
  } | null>(null);

  // Add Provider Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'custom' | 'preset'>('custom');
  const [chosenPresetId, setChosenPresetId] = useState('cohere');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState<AiProtocolFormat>('openai_compatible');
  const [newBaseUrl, setNewBaseUrl] = useState('http://localhost:1234/v1');
  const [newModel, setNewModel] = useState('local-model');
  const [newAuthType, setNewAuthType] = useState<AiAuthType>('bearer');
  const [newAuthHeaderName, setNewAuthHeaderName] = useState('Authorization');
  const [newAuthPrefix, setNewAuthPrefix] = useState('Bearer ');
  const [newApiKey, setNewApiKey] = useState('');
  const [newResponsePath, setNewResponsePath] = useState('');
  const [newHeadersText, setNewHeadersText] = useState('{}');
  const [newSetDefault, setNewSetDefault] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, presetRes] = await Promise.allSettled([api.getAiProviders(), api.getAiPresets()]);
      let provList: AiProviderModel[] = [];
      if (provRes.status === 'fulfilled') {
        provList = provRes.value;
        setProviders(provList);
      } else {
        setError((provRes.reason as Error)?.message || 'Failed to load AI providers');
      }
      if (presetRes.status === 'fulfilled' && Array.isArray(presetRes.value)) {
        setPresets(presetRes.value);
      } else if (presetRes.status === 'rejected') {
        setError((presetRes.reason as Error)?.message || 'Failed to load AI presets');
      }
      return provList;
    } finally {
      setLoading(false);
    }
  }, [api]);

  const hydrateForm = useCallback((p: AiProviderModel) => {
    setSelectedId(p.id);
    setName(p.name);
    setApiFormat(p.apiFormat);
    setBaseUrl(p.baseUrl);
    setDefaultModel(p.defaultModel);
    setModelsText(p.models.join(', '));
    setAuthType(p.authType);
    setAuthHeaderName(p.authHeaderName || 'Authorization');
    setAuthPrefix(p.authPrefix ?? 'Bearer ');
    setApiKeyParamName(p.apiKeyParamName || 'key');
    setApiVersion(p.apiVersion || '2024-10-21');
    setResponsePath(p.responsePath || '');
    setApiKeyInput('');
    setClearApiKey(false);
    setRequiresApiKey(p.requiresApiKey);
    setCustomHeadersText(JSON.stringify(p.customHeaders ?? {}, null, 2));
    setCustomBodyText(JSON.stringify(p.customBodyTemplate ?? {}, null, 2));
    setTimeoutMs(p.timeoutMs || 30000);
    setEnabled(p.enabled);
    setTestResult(null);
    setFeedback(null);
    setError(null);
  }, []);

  useEffect(() => {
    void loadData().then(list => {
      if (list.length > 0) {
        const def = list.find(p => p.id === selectedId) ?? list.find(p => p.isDefault) ?? list[0];
        hydrateForm(def);
      }
    });
  }, []);

  const selectedProvider = useMemo(
    () => providers.find(p => p.id === selectedId) ?? null,
    [providers, selectedId]
  );

  const selectedPresetMeta = useMemo(
    () => presets.find(pr => pr.presetId === (selectedProvider?.presetId ?? 'custom')) ?? null,
    [presets, selectedProvider]
  );

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;
    setError(null);
    setFeedback(null);

    let parsedHeaders: Record<string, string> = {};
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedHeaders = customHeadersText.trim() ? (JSON.parse(customHeadersText) as Record<string, string>) : {};
    } catch {
      setError('Custom Headers must be valid JSON.');
      return;
    }
    try {
      parsedBody = customBodyText.trim() ? (JSON.parse(customBodyText) as Record<string, unknown>) : {};
    } catch {
      setError('Custom Body Template must be valid JSON.');
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateAiProvider(selectedProvider.id, {
        name: name.trim() || selectedProvider.name,
        apiFormat,
        baseUrl: baseUrl.trim(),
        defaultModel: defaultModel.trim(),
        models: modelsText
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        authType,
        authHeaderName,
        authPrefix,
        apiKeyParamName,
        apiVersion,
        responsePath,
        customHeaders: parsedHeaders,
        customBodyTemplate: parsedBody,
        timeoutMs,
        enabled,
        requiresApiKey,
        apiKey: apiKeyInput.trim() || undefined,
        clearApiKey
      });
      const list = await loadData();
      const fresh = list.find(p => p.id === updated.id) ?? updated;
      hydrateForm(fresh);
      setFeedback(`Saved "${fresh.name}" (API key encrypted in AES-256-GCM vault).`);
      onLog('success', `Updated AI provider "${fresh.name}" (${fresh.id}).`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async () => {
    if (!selectedProvider) return;
    setError(null);
    try {
      const updated = await api.setDefaultAiProvider(selectedProvider.id);
      const list = await loadData();
      hydrateForm(list.find(p => p.id === updated.id) ?? updated);
      setFeedback(`"${updated.name}" is now the default AI provider.`);
      onLog('success', `Default AI provider set to "${updated.name}".`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedProvider) return;
    setTesting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.testAiProvider(selectedProvider.id);
      setTestResult({
        ok: res.ok,
        stub: res.stub,
        model: res.model,
        latencyMs: res.latencyMs,
        content: res.preview || res.message
      });
      setFeedback(res.message);
      onLog(res.ok ? 'success' : 'error', `AI test [${selectedProvider.id}]: ${res.message}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleRunPlayground = async () => {
    if (!selectedProvider || !testPrompt.trim()) return;
    setTesting(true);
    setError(null);
    try {
      const res = await api.testAiChat({
        provider: selectedProvider.id,
        model: defaultModel || selectedProvider.defaultModel,
        prompt: testPrompt.trim(),
        max_tokens: 400
      });
      setTestResult({
        ok: res.ok,
        stub: res.stub,
        model: res.model,
        latencyMs: res.latency_ms,
        content: res.content
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteProvider = async () => {
    if (!selectedProvider) return;
    try {
      await api.deleteAiProvider(selectedProvider.id);
      const list = await loadData();
      if (list[0]) hydrateForm(list[0]);
      onLog('info', `Deleted AI provider "${selectedProvider.name}".`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const selectablePresets = useMemo(
    () => presets.filter(p => p.presetId !== 'custom'),
    [presets]
  );

  const applyPresetToAddModal = useCallback((pr: AiProviderPreset) => {
    setChosenPresetId(pr.presetId);
    setNewId(pr.presetId);
    setNewName(pr.name);
    setNewFormat(pr.apiFormat);
    setNewBaseUrl(pr.baseUrl);
    setNewModel(pr.defaultModel);
    setNewAuthType(pr.authType);
    setNewAuthHeaderName(pr.authHeaderName || 'Authorization');
    setNewAuthPrefix(pr.authPrefix ?? 'Bearer ');
    setNewApiKey('');
    setNewResponsePath('');
    setNewHeadersText('{}');
  }, []);

  useEffect(() => {
    if (showAddModal && addMode === 'preset' && selectablePresets.length > 0) {
      const exists = selectablePresets.some(p => p.presetId === chosenPresetId);
      if (!exists) {
        applyPresetToAddModal(selectablePresets[0]);
      }
    }
  }, [showAddModal, addMode, selectablePresets, chosenPresetId, applyPresetToAddModal]);

  const openAddModal = (mode: 'custom' | 'preset') => {
    setAddMode(mode);
    if (mode === 'custom') {
      setNewId('');
      setNewName('My Custom AI');
      setNewFormat('openai_compatible');
      setNewBaseUrl('http://localhost:1234/v1');
      setNewModel('local-llama-3');
      setNewAuthType('bearer');
      setNewAuthHeaderName('Authorization');
      setNewAuthPrefix('Bearer ');
      setNewApiKey('');
      setNewResponsePath('');
      setNewHeadersText('{}');
      setNewSetDefault(false);
    } else {
      const pr = selectablePresets.find(p => p.presetId === chosenPresetId) ?? selectablePresets[0];
      if (pr) {
        applyPresetToAddModal(pr);
      } else {
        api
          .getAiPresets()
          .then(list => {
            setPresets(list);
            const first = list.find(p => p.presetId === chosenPresetId && p.presetId !== 'custom') ?? list.find(p => p.presetId !== 'custom') ?? list[0];
            if (first) applyPresetToAddModal(first);
          })
          .catch(err => setError((err as Error).message));
      }
    }
    setShowAddModal(true);
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let parsedHeaders: Record<string, string> = {};
    try {
      parsedHeaders = newHeadersText.trim() ? (JSON.parse(newHeadersText) as Record<string, string>) : {};
    } catch {
      setError('Custom Headers JSON in modal is invalid.');
      return;
    }

    const presetRef = addMode === 'preset' ? presets.find(p => p.presetId === chosenPresetId) : null;
    try {
      const created = await api.saveAiProvider({
        id: newId.trim() || undefined,
        name: newName.trim(),
        presetId: addMode === 'custom' ? 'custom' : chosenPresetId,
        isCustom: addMode === 'custom',
        apiFormat: newFormat,
        baseUrl: newBaseUrl.trim(),
        defaultModel: newModel.trim() || 'custom-model',
        models: presetRef ? presetRef.models : [newModel.trim() || 'custom-model'],
        authType: newAuthType,
        authHeaderName: newAuthHeaderName,
        authPrefix: newAuthPrefix,
        responsePath: newResponsePath,
        customHeaders: parsedHeaders,
        requiresApiKey: newAuthType !== 'none' && (addMode === 'preset' ? Boolean(presetRef?.requiresApiKey) : Boolean(newApiKey.trim())),
        apiKey: newApiKey.trim() || null,
        isDefault: newSetDefault,
        enabled: true
      });
      setShowAddModal(false);
      const list = await loadData();
      hydrateForm(list.find(p => p.id === created.id) ?? created);
      setFeedback(`Added provider "${created.name}" (${created.id}).`);
      onLog('success', `Added AI provider "${created.name}" (${created.id}).`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const luaSnippet = useMemo(() => {
    if (!selectedProvider) return '';
    return `local reply = ai.chat({
  provider = "${selectedProvider.id}",
  model = "${defaultModel || selectedProvider.defaultModel}",
  system = "You are a helpful Poseidon assistant.",
  messages = {
    { role = "user", content = "Analyze this payload..." }
  },
  temperature = 0.7
})
flow.log(reply.content)`;
  }, [selectedProvider, defaultModel]);

  return (
    <div className="db-layout">
      {/* Left Sidebar: Provider Connections */}
      <aside className="db-sidebar" style={{ width: '290px' }}>
        <div className="pane-header">
          <span>AI Connections ({providers.length})</span>
          <button
            type="button"
            className="btn-accent"
            style={{ padding: '4px 8px', fontSize: '11.5px' }}
            onClick={() => openAddModal('custom')}
          >
            + Custom
          </button>
        </div>

        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '6px' }}>
          <button type="button" style={{ flex: 1, justifyContent: 'center', fontSize: '11.5px' }} onClick={() => openAddModal('preset')}>
            + Add Preset
          </button>
          <button type="button" style={{ fontSize: '11.5px' }} onClick={() => void loadData()}>
            Refresh
          </button>
        </div>

        <div className="db-table-list">
          {loading && providers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '12px', fontSize: '12px' }}>Loading providers...</div>
          ) : (
            providers.map(p => {
              const statusLabel = !p.enabled
                ? 'Disabled'
                : p.hasApiKey
                  ? 'Key Ready'
                  : !p.requiresApiKey
                    ? 'No Key Req'
                    : 'Stub';
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`db-table-item ${selectedId === p.id ? 'active' : ''}`}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '9px 10px' }}
                  onClick={() => hydrateForm(p)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: '10.5px',
                        color: p.isDefault ? '#60a5fa' : p.hasApiKey ? '#4ade80' : 'var(--text-muted)'
                      }}
                    >
                      {p.isDefault ? 'DEFAULT' : statusLabel}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span className="mono">{p.id}{p.isCustom ? ' · custom' : ''}</span>
                    <span>{p.apiFormat}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="db-main" style={{ overflowY: 'auto' }}>
        {selectedProvider ? (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Top Header */}
            <div className="page-header" style={{ paddingBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h2 className="page-title" style={{ marginBottom: 0 }}>{selectedProvider.name}</h2>
                  <span className="mono" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    provider="{selectedProvider.id}"
                  </span>
                  {selectedProvider.isDefault && (
                    <span className="status-text completed" style={{ fontSize: '12px' }}>
                      Active Default
                    </span>
                  )}
                </div>
                <p className="page-subtitle" style={{ marginTop: '4px' }}>
                  {selectedPresetMeta?.docsHint || 'Configure endpoint URL, wire format, encrypted API key, and custom headers.'}
                </p>
              </div>

              <div className="toolbar-group" style={{ flexWrap: 'wrap' }}>
                {!selectedProvider.isDefault && (
                  <button type="button" onClick={() => void handleSetDefault()}>
                    Set as Default
                  </button>
                )}
                <button type="button" onClick={() => void handleTestConnection()} disabled={testing}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button type="button" className="btn-danger" onClick={() => void handleDeleteProvider()}>
                  Delete
                </button>
              </div>
            </div>

            {error && <div className="form-error" style={{ marginBottom: 0 }}>{error}</div>}
            {feedback && (
              <div
                style={{
                  background: 'rgba(34, 197, 94, 0.1)',
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

            {/* Configuration Form */}
            <form
              onSubmit={handleSaveProvider}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '16px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '14px'
              }}
            >
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Display Name</label>
                <input value={name} onChange={e => setName(e.target.value)} required />
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Protocol / API Format</label>
                <select value={apiFormat} onChange={e => setApiFormat(e.target.value as AiProtocolFormat)}>
                  {PROTOCOL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-field" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label>Base URL / Endpoint URL</label>
                <input
                  className="mono"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  required
                />
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Default Model</label>
                <input
                  className="mono"
                  value={defaultModel}
                  onChange={e => setDefaultModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                />
                {selectedProvider.models.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {selectedProvider.models.slice(0, 5).map(m => (
                      <button
                        key={m}
                        type="button"
                        style={{
                          padding: '2px 7px',
                          fontSize: '11px',
                          borderColor: defaultModel === m ? 'var(--accent)' : 'var(--border)',
                          background: defaultModel === m ? 'var(--accent-soft)' : 'var(--bg)'
                        }}
                        onClick={() => setDefaultModel(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Model Catalog (comma-separated)</label>
                <input
                  className="mono"
                  value={modelsText}
                  onChange={e => setModelsText(e.target.value)}
                  placeholder="model-a, model-b"
                />
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Authentication Type</label>
                <select value={authType} onChange={e => setAuthType(e.target.value as AiAuthType)}>
                  {AUTH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>
                  API Key{' '}
                  {selectedProvider.hasApiKey && (
                    <span className="mono" style={{ color: '#4ade80', fontWeight: 400 }}>
                      (stored: {selectedProvider.maskedApiKey})
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  className="mono"
                  value={apiKeyInput}
                  onChange={e => {
                    setApiKeyInput(e.target.value);
                    if (e.target.value) setClearApiKey(false);
                  }}
                  placeholder={selectedProvider.hasApiKey ? 'Leave blank to keep stored key' : 'Enter API key...'}
                  disabled={authType === 'none'}
                />
                {selectedProvider.hasApiKey && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 400, marginTop: '4px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={e => setClearApiKey(e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    Clear stored key
                  </label>
                )}
              </div>

              {authType === 'header' && (
                <>
                  <div className="form-field" style={{ marginBottom: 0 }}>
                    <label>Custom Auth Header Name</label>
                    <input className="mono" value={authHeaderName} onChange={e => setAuthHeaderName(e.target.value)} />
                  </div>
                  <div className="form-field" style={{ marginBottom: 0 }}>
                    <label>Custom Auth Value Prefix</label>
                    <input className="mono" value={authPrefix} onChange={e => setAuthPrefix(e.target.value)} placeholder="Bearer " />
                  </div>
                </>
              )}

              {authType === 'query_param' && (
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Query Param Name</label>
                  <input className="mono" value={apiKeyParamName} onChange={e => setApiKeyParamName(e.target.value)} placeholder="key" />
                </div>
              )}

              {apiFormat === 'azure_openai' && (
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Azure API Version</label>
                  <input className="mono" value={apiVersion} onChange={e => setApiVersion(e.target.value)} />
                </div>
              )}

              {apiFormat === 'custom_json' && (
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Response JSON Path (optional)</label>
                  <input
                    className="mono"
                    value={responsePath}
                    onChange={e => setResponsePath(e.target.value)}
                    placeholder="e.g. choices.0.message.content or output.text"
                  />
                </div>
              )}

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Custom Headers (JSON)</label>
                <textarea
                  className="mono"
                  rows={2}
                  value={customHeadersText}
                  onChange={e => setCustomHeadersText(e.target.value)}
                />
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Extra Request Body JSON</label>
                <textarea
                  className="mono"
                  rows={2}
                  value={customBodyText}
                  onChange={e => setCustomBodyText(e.target.value)}
                />
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Timeout (ms)</label>
                <input
                  type="number"
                  min={1000}
                  max={180000}
                  className="mono tabular-nums"
                  value={timeoutMs}
                  onChange={e => setTimeoutMs(Number(e.target.value) || 30000)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', paddingTop: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setEnabled(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  Enabled
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px' }}>
                  <input
                    type="checkbox"
                    checked={requiresApiKey}
                    onChange={e => setRequiresApiKey(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  Require API Key (uncheck for keyless local servers)
                </label>
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                <button type="submit" className="btn-accent" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Provider Config'}
                </button>
              </div>
            </form>

            {/* Bottom Grid: Playground + Lua Snippet */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {/* Prompt Playground */}
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px' }}>Prompt Test Playground</strong>
                  <button
                    type="button"
                    className="btn-accent"
                    disabled={testing}
                    onClick={() => void handleRunPlayground()}
                  >
                    {testing ? 'Sending...' : 'Send Prompt'}
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={testPrompt}
                  onChange={e => setTestPrompt(e.target.value)}
                  placeholder="Write a test prompt..."
                />
                {testResult && (
                  <div
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '5px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div className="meta-line tabular-nums">
                      <span className={`status-text ${testResult.ok ? 'completed' : 'failed'}`}>
                        {testResult.stub ? 'stub' : testResult.ok ? 'live ok' : 'error'}
                      </span>
                      <span>·</span>
                      <span className="mono">{testResult.model}</span>
                      <span>·</span>
                      <span>{testResult.latencyMs}ms</span>
                    </div>
                    <pre className="mono" style={{ margin: 0, fontSize: '11.5px', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                      {testResult.content}
                    </pre>
                  </div>
                )}
              </div>

              {/* Lua Usage Snippet */}
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px' }}>Lua Usage Snippet</strong>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(luaSnippet);
                      setFeedback('Copied Lua snippet to clipboard.');
                    }}
                  >
                    Copy Snippet
                  </button>
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '5px',
                    padding: '12px',
                    fontSize: '11.5px',
                    color: '#93c5fd',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {luaSnippet}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px', color: 'var(--text-muted)' }}>Select or add an AI provider.</div>
        )}
      </main>

      {/* Add Custom / Preset Provider Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '14px' }}>Add AI Provider Connection</h3>
              <button type="button" onClick={() => setShowAddModal(false)}>Close</button>
            </div>
            <form className="modal-body" onSubmit={handleCreateProvider}>
              {error && <div className="form-error" style={{ marginBottom: 0 }}>{error}</div>}
              <div className="segmented-control">
                <button
                  type="button"
                  className={addMode === 'custom' ? 'active' : ''}
                  onClick={() => openAddModal('custom')}
                >
                  Custom Provider
                </button>
                <button
                  type="button"
                  className={addMode === 'preset' ? 'active' : ''}
                  onClick={() => openAddModal('preset')}
                >
                  From Built-in Preset
                </button>
              </div>

              {addMode === 'preset' && (
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Select Provider Preset</label>
                  {selectablePresets.length > 0 ? (
                    <select
                      value={
                        selectablePresets.some(p => p.presetId === chosenPresetId)
                          ? chosenPresetId
                          : selectablePresets[0].presetId
                      }
                      onChange={e => {
                        const pr = selectablePresets.find(p => p.presetId === e.target.value);
                        if (pr) applyPresetToAddModal(pr);
                      }}
                    >
                      {selectablePresets.map(p => (
                        <option key={p.presetId} value={p.presetId}>
                          {p.name} — {p.description}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <select disabled style={{ flex: 1 }}>
                        <option value="">No presets loaded yet</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          void api
                            .getAiPresets()
                            .then(list => {
                              setPresets(list);
                              const first = list.find(p => p.presetId !== 'custom') ?? list[0];
                              if (first) applyPresetToAddModal(first);
                            })
                            .catch(err => setError((err as Error).message));
                        }}
                      >
                        Reload Presets
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Display Name</label>
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Internal vLLM Gateway"
                    required
                  />
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Provider Slug ID (used in Lua)</label>
                  <input
                    className="mono"
                    value={newId}
                    onChange={e => setNewId(e.target.value)}
                    placeholder="auto-generated if blank"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Protocol Format</label>
                  <select value={newFormat} onChange={e => setNewFormat(e.target.value as AiProtocolFormat)}>
                    {PROTOCOL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Default Model</label>
                  <input
                    className="mono"
                    value={newModel}
                    onChange={e => setNewModel(e.target.value)}
                    placeholder="llama-3.3-70b"
                    required
                  />
                </div>
              </div>

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Base URL / Endpoint URL</label>
                <input
                  className="mono"
                  value={newBaseUrl}
                  onChange={e => setNewBaseUrl(e.target.value)}
                  placeholder="https://my-llm.example.com/v1"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Auth Type</label>
                  <select value={newAuthType} onChange={e => setNewAuthType(e.target.value as AiAuthType)}>
                    {AUTH_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>API Key (optional for keyless/local)</label>
                  <input
                    type="password"
                    className="mono"
                    value={newApiKey}
                    onChange={e => setNewApiKey(e.target.value)}
                    placeholder="sk-..."
                    disabled={newAuthType === 'none'}
                  />
                </div>
              </div>

              {newAuthType === 'header' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div className="form-field" style={{ marginBottom: 0 }}>
                    <label>Header Name</label>
                    <input className="mono" value={newAuthHeaderName} onChange={e => setNewAuthHeaderName(e.target.value)} />
                  </div>
                  <div className="form-field" style={{ marginBottom: 0 }}>
                    <label>Value Prefix</label>
                    <input className="mono" value={newAuthPrefix} onChange={e => setNewAuthPrefix(e.target.value)} />
                  </div>
                </div>
              )}

              {newFormat === 'custom_json' && (
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Response JSON Path (optional)</label>
                  <input
                    className="mono"
                    value={newResponsePath}
                    onChange={e => setNewResponsePath(e.target.value)}
                    placeholder="e.g. data.reply or choices.0.message.content"
                  />
                </div>
              )}

              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Custom Headers JSON</label>
                <input
                  className="mono"
                  value={newHeadersText}
                  onChange={e => setNewHeadersText(e.target.value)}
                  placeholder='{"X-Tenant": "poseidon"}'
                />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px' }}>
                <input
                  type="checkbox"
                  checked={newSetDefault}
                  onChange={e => setNewSetDefault(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Set as default AI provider
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                <button type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-accent">Add Provider</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
