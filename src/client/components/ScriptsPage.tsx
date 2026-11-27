import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api';
import type { ExecutionModel, LogEntry, ScriptTemplate, WorkflowModel } from '../types';

interface ScriptsPageProps {
  api: ApiClient;
  activeWorkflowRuns: Record<number, number[]>; // workflowId -> executionIds
  onEditWorkflow: (workflow: WorkflowModel) => void;
  onUseTemplate: (template: ScriptTemplate) => void;
  onCreateNew: () => void;
  onLog: (level: LogEntry['level'], message: string) => void;
  onExecutionStarted: (executionId: number, workflowId: number) => void;
  onExecutionStopped: (workflowId: number, executionId?: number) => void;
}

export const ScriptsPage: React.FC<ScriptsPageProps> = ({
  api,
  activeWorkflowRuns,
  onEditWorkflow,
  onUseTemplate,
  onCreateNew,
  onLog,
  onExecutionStarted,
  onExecutionStopped
}) => {
  const [subTab, setSubTab] = useState<'workflows' | 'templates'>('workflows');
  const [workflows, setWorkflows] = useState<WorkflowModel[]>([]);
  const [templates, setTemplates] = useState<ScriptTemplate[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'blueprint' | 'code'>('all');
  const [templateCategory, setTemplateCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<WorkflowModel | null>(null);
  const [executions, setExecutions] = useState<ExecutionModel[]>([]);
  const [selectedExecDetails, setSelectedExecDetails] = useState<{
    id: number;
    steps: Array<{
      id: number;
      node_name: string;
      status: string;
      output_json: string | null;
      error: string | null;
      duration_ms: number | null;
    }>;
  } | null>(null);

  // Create Template Modal
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState('Custom');
  const [tplDescription, setTplDescription] = useState('');
  const [tplContent, setTplContent] = useState(
    `return {\n  run = function(context)\n    flow.log("Custom template running")\n    return { ok = true, at = flow.now() }\n  end\n}`
  );

  const loadSeqRef = useRef(0);

  const loadAll = useCallback(
    async (silent = false) => {
      const seq = ++loadSeqRef.current;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const [wfList, tplList] = await Promise.all([api.getWorkflows(), api.getScripts()]);
        if (seq !== loadSeqRef.current) return;
        setWorkflows(wfList);
        setTemplates(tplList);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setError((err as Error).message);
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    void loadAll(workflows.length > 0);
  }, [loadAll, activeWorkflowRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = async (wf: WorkflowModel) => {
    try {
      const res = await api.executeWorkflow(wf.id, {});
      onExecutionStarted(res.executionId, wf.id);
      onLog('info', `Started "${wf.name}" (execution #${res.executionId})`);
      await loadAll(true);
    } catch (err) {
      onLog('error', `Failed to run "${wf.name}": ${(err as Error).message}`);
    }
  };

  const handleStop = async (wf: WorkflowModel) => {
    try {
      const activeExecIds = activeWorkflowRuns[wf.id] ?? [];
      if (activeExecIds.length === 1) {
        await api.stopExecution(activeExecIds[0]);
      } else {
        await api.stopWorkflow(wf.id);
      }
      onExecutionStopped(wf.id);
      onLog('error', `Stopped "${wf.name}"`);
      await loadAll(true);
    } catch (err) {
      onLog('error', `Failed to stop "${wf.name}": ${(err as Error).message}`);
    }
  };

  const handleStopAll = async () => {
    try {
      const res = await api.stopAllExecutions();
      for (const wfIdStr of Object.keys(activeWorkflowRuns)) {
        onExecutionStopped(Number(wfIdStr));
      }
      onLog('error', `Stopped all active runs (${res.stoppedCount}).`);
      await loadAll(true);
    } catch (err) {
      onLog('error', `Failed to stop all runs: ${(err as Error).message}`);
    }
  };

  const handleClone = async (wf: WorkflowModel) => {
    try {
      const cloned = await api.cloneWorkflow(wf.id);
      onLog('success', `Cloned "${wf.name}" -> "${cloned.name}" (#${cloned.id})`);
      await loadAll();
    } catch (err) {
      onLog('error', `Clone failed: ${(err as Error).message}`);
    }
  };

  const handleToggleActive = async (wf: WorkflowModel) => {
    try {
      await api.updateWorkflow(wf.id, { is_active: !wf.is_active });
      onLog('info', `${wf.is_active ? 'Paused' : 'Activated'} "${wf.name}"`);
      await loadAll();
    } catch (err) {
      onLog('error', `Update failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (wf: WorkflowModel) => {
    try {
      await api.deleteWorkflow(wf.id);
      onLog('info', `Deleted "${wf.name}"`);
      await loadAll();
    } catch (err) {
      onLog('error', `Delete failed: ${(err as Error).message}`);
    }
  };

  const handleSaveTemplateAsWorkflow = async (tpl: ScriptTemplate) => {
    try {
      const created = await api.createWorkflow({
        name: tpl.name.replace(/\.lua$/i, ''),
        description: tpl.description || `Created from Lua template ${tpl.name}`,
        mode: 'code',
        trigger_type: 'manual',
        is_active: true,
        nodes: [
          {
            client_id: 'code1',
            type: 'code',
            name: tpl.name,
            script: tpl.content,
            x: 200,
            y: 150
          }
        ],
        edges: []
      });
      onLog('success', `Saved template "${tpl.name}" as workflow #${created.id}.`);
      setSubTab('workflows');
      await loadAll();
    } catch (err) {
      onLog('error', `Failed to save template: ${(err as Error).message}`);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplName.trim()) return;
    try {
      await api.createScriptTemplate({
        name: tplName.trim(),
        category: tplCategory.trim() || 'Custom',
        description: tplDescription.trim(),
        content: tplContent
      });
      setShowCreateTemplate(false);
      setTplName('');
      setTplDescription('');
      onLog('success', `Saved Lua script template "${tplName.trim()}".`);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteTemplate = async (tpl: ScriptTemplate) => {
    try {
      await api.deleteScriptTemplate(tpl.id);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openHistory = async (wf: WorkflowModel) => {
    setHistoryFor(wf);
    setSelectedExecDetails(null);
    try {
      const list = await api.getExecutions(wf.id);
      setExecutions(list);
      if (list[0]) {
        const det = await api.getExecutionDetails(list[0].id);
        setSelectedExecDetails(det);
      }
    } catch (err) {
      onLog('error', `Failed to load executions: ${(err as Error).message}`);
    }
  };

  const filteredWorkflows = workflows.filter(wf => {
    if (filterMode !== 'all' && wf.mode !== filterMode) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return wf.name.toLowerCase().includes(q) || (wf.description ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const categories = Array.from(new Set(templates.map(t => t.category || 'Custom')));
  const filteredTemplates = templates.filter(tpl => {
    if (templateCategory !== 'all' && (tpl.category || 'Custom') !== templateCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        tpl.name.toLowerCase().includes(q) ||
        (tpl.description ?? '').toLowerCase().includes(q) ||
        tpl.content.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Saved Scripts & Lua Template Library</h2>
          <p className="page-subtitle">
            Run, stop, edit, clone, or inspect workflows alongside reusable Lua script examples.
          </p>
        </div>

        <div className="toolbar-group" style={{ flexWrap: 'wrap' }}>
          <div className="segmented-control" style={{ width: '310px' }}>
            <button
              type="button"
              className={subTab === 'workflows' ? 'active' : ''}
              onClick={() => setSubTab('workflows')}
            >
              Workflows ({workflows.length})
            </button>
            <button
              type="button"
              className={subTab === 'templates' ? 'active' : ''}
              onClick={() => setSubTab('templates')}
            >
              Lua Templates ({templates.length})
            </button>
          </div>

          <input
            placeholder="Search scripts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '190px' }}
          />

          {subTab === 'workflows' ? (
            <select
              value={filterMode}
              onChange={e => setFilterMode(e.target.value as 'all' | 'blueprint' | 'code')}
            >
              <option value="all">All Types</option>
              <option value="blueprint">Blueprints</option>
              <option value="code">Code Scripts</option>
            </select>
          ) : (
            <select value={templateCategory} onChange={e => setTemplateCategory(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}

          <button type="button" onClick={() => void loadAll()}>
            Refresh
          </button>

          {subTab === 'workflows' &&
            workflows.some(
              wf =>
                (activeWorkflowRuns[wf.id]?.length ?? 0) > 0 ||
                wf.latest_execution?.status === 'running' ||
                wf.latest_execution?.status === 'queued'
            ) && (
              <button type="button" className="btn-danger" onClick={() => void handleStopAll()}>
                Stop All Running
              </button>
            )}

          {subTab === 'workflows' ? (
            <button type="button" className="btn-accent" onClick={onCreateNew}>
              + New Script
            </button>
          ) : (
            <button type="button" className="btn-accent" onClick={() => setShowCreateTemplate(true)}>
              + New Template
            </button>
          )}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {subTab === 'workflows' ? (
        loading && workflows.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)' }}>Loading scripts from server...</div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="script-card" style={{ alignItems: 'center', padding: '36px' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              No matching scripts or blueprints found.
            </p>
            <button type="button" className="btn-accent" onClick={onCreateNew}>
              Create your first script
            </button>
          </div>
        ) : (
          <div className="scripts-grid">
            {filteredWorkflows.map(wf => {
              const runningExecIds = activeWorkflowRuns[wf.id] ?? [];
              const isRunning =
                runningExecIds.length > 0 ||
                wf.latest_execution?.status === 'running' ||
                wf.latest_execution?.status === 'queued';
              const status =
                runningExecIds.length > 0 ? 'running' : wf.latest_execution?.status ?? 'idle';
              const triggerLabel =
                wf.trigger_type === 'schedule'
                  ? `every ${wf.schedule_seconds ?? 60}s`
                  : wf.trigger_type === 'webhook'
                    ? `webhook /api/webhooks/${wf.id}`
                    : 'manual';

              return (
                <div key={wf.id} className="script-card">
                  <div>
                    <h3 className="script-title">{wf.name}</h3>
                    <div className="meta-line">
                      <span className={`status-text ${status}`}>{status}</span>
                      <span>·</span>
                      <span>{wf.mode === 'blueprint' ? 'Blueprint' : 'Lua Code'}</span>
                      <span>·</span>
                      <span>{triggerLabel}</span>
                      <span>·</span>
                      <span className={wf.is_active ? 'status-text completed' : 'status-text idle'}>
                        {wf.is_active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  </div>

                  {wf.description && (
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      {wf.description}
                    </div>
                  )}

                  <div className="code-snippet">{wf.nodes[0]?.script || '-- Empty script'}</div>

                  <div className="meta-line tabular-nums">
                    <span>ID #{wf.id}</span>
                    <span>·</span>
                    <span>
                      {wf.nodes.length} node{wf.nodes.length === 1 ? '' : 's'}
                    </span>
                    <span>·</span>
                    <span>
                      {wf.edges.length} edge{wf.edges.length === 1 ? '' : 's'}
                    </span>
                    <span>·</span>
                    <span>Updated {new Date(wf.updated_at).toLocaleTimeString()}</span>
                  </div>

                  <div className="script-actions">
                    <button
                      type="button"
                      className="btn-accent"
                      disabled={isRunning}
                      onClick={() => void handleRun(wf)}
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={!isRunning}
                      onClick={() => void handleStop(wf)}
                    >
                      Stop
                    </button>
                    <button type="button" onClick={() => onEditWorkflow(wf)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void handleClone(wf)}>
                      Clone
                    </button>
                    <button type="button" onClick={() => void handleToggleActive(wf)}>
                      {wf.is_active ? 'Pause' : 'Activate'}
                    </button>
                    <button type="button" onClick={() => void openHistory(wf)}>
                      Logs
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => void handleDelete(wf)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Lua Script Templates Library */
        <div className="scripts-grid">
          {filteredTemplates.map(tpl => (
            <div key={tpl.id} className="script-card">
              <div>
                <h3 className="script-title mono">{tpl.name}</h3>
                <div className="meta-line">
                  <span style={{ color: '#93c5fd', fontWeight: 600 }}>{tpl.category || 'Custom'}</span>
                  <span>·</span>
                  <span>v{tpl.version}</span>
                  <span>·</span>
                  <span>Template #{tpl.id}</span>
                </div>
              </div>

              {tpl.description && (
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  {tpl.description}
                </div>
              )}

              <div className="code-snippet">{tpl.content}</div>

              <div className="script-actions">
                <button type="button" className="btn-accent" onClick={() => onUseTemplate(tpl)}>
                  Open in Studio
                </button>
                <button type="button" onClick={() => void handleSaveTemplateAsWorkflow(tpl)}>
                  Add to Workflows
                </button>
                <button type="button" className="btn-ghost" onClick={() => void handleDeleteTemplate(tpl)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="modal-backdrop" onClick={() => setShowCreateTemplate(false)}>
          <div className="modal-box" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong style={{ fontSize: '13.5px', color: '#ffffff' }}>Create Lua Script Template</strong>
              <button type="button" onClick={() => setShowCreateTemplate(false)}>Close</button>
            </div>
            <form className="modal-body" onSubmit={handleCreateTemplate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '10px' }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Template Filename</label>
                  <input
                    className="mono"
                    value={tplName}
                    onChange={e => setTplName(e.target.value)}
                    placeholder="e.g. slack_alert.lua"
                    required
                  />
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Category</label>
                  <input
                    value={tplCategory}
                    onChange={e => setTplCategory(e.target.value)}
                    placeholder="AI / Data / Notify"
                  />
                </div>
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Description</label>
                <input
                  value={tplDescription}
                  onChange={e => setTplDescription(e.target.value)}
                  placeholder="Short summary of what this script does"
                />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Lua Source</label>
                <textarea
                  className="lua-textarea"
                  rows={10}
                  spellCheck={false}
                  value={tplContent}
                  onChange={e => setTplContent(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setShowCreateTemplate(false)}>Cancel</button>
                <button type="submit" className="btn-accent">Save Template</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Execution History Modal */}
      {historyFor && (
        <div className="modal-backdrop" onClick={() => setHistoryFor(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong style={{ fontSize: '13.5px', color: '#ffffff' }}>
                Execution History — {historyFor.name}
              </strong>
              <button type="button" onClick={() => setHistoryFor(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              {executions.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>
                  No executions recorded yet. Click Run to execute this workflow on the server.
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {executions.slice(0, 10).map(ex => (
                      <button
                        key={ex.id}
                        type="button"
                        className={selectedExecDetails?.id === ex.id ? 'btn-accent' : ''}
                        onClick={async () => {
                          const det = await api.getExecutionDetails(ex.id);
                          setSelectedExecDetails(det);
                        }}
                      >
                        <span className="tabular-nums">#{ex.id}</span>
                        <span>({ex.status})</span>
                      </button>
                    ))}
                  </div>

                  {selectedExecDetails && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {selectedExecDetails.steps.map(step => (
                        <div
                          key={step.id}
                          style={{
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '10px 12px'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '6px'
                            }}
                          >
                            <strong>{step.node_name}</strong>
                            <span className={`status-text ${step.status} tabular-nums`}>
                              {step.status}
                              {step.duration_ms !== null ? ` · ${step.duration_ms}ms` : ''}
                            </span>
                          </div>
                          {step.output_json && (
                            <pre
                              className="mono"
                              style={{
                                margin: 0,
                                fontSize: '11.5px',
                                color: '#86efac',
                                whiteSpace: 'pre-wrap'
                              }}
                            >
                              {step.output_json}
                            </pre>
                          )}
                          {step.error && (
                            <pre
                              className="mono"
                              style={{
                                margin: 0,
                                fontSize: '11.5px',
                                color: '#fca5a5',
                                whiteSpace: 'pre-wrap'
                              }}
                            >
                              {step.error}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
