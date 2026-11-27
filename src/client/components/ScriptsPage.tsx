import React, { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import type { ExecutionModel, LogEntry, WorkflowModel } from '../types';

interface ScriptsPageProps {
  api: ApiClient;
  activeWorkflowRuns: Record<number, number>; // workflowId -> executionId
  onEditWorkflow: (workflow: WorkflowModel) => void;
  onCreateNew: () => void;
  onLog: (level: LogEntry['level'], message: string) => void;
  onExecutionStarted: (executionId: number, workflowId: number) => void;
}

export const ScriptsPage: React.FC<ScriptsPageProps> = ({
  api,
  activeWorkflowRuns,
  onEditWorkflow,
  onCreateNew,
  onLog,
  onExecutionStarted
}) => {
  const [workflows, setWorkflows] = useState<WorkflowModel[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'blueprint' | 'code'>('all');
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

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getWorkflows();
      setWorkflows(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows, activeWorkflowRuns]);

  const handleRun = async (wf: WorkflowModel) => {
    try {
      const res = await api.executeWorkflow(wf.id, {});
      onExecutionStarted(res.executionId, wf.id);
      onLog('info', `Started "${wf.name}" (execution #${res.executionId})`);
      await loadWorkflows();
    } catch (err) {
      onLog('error', `Failed to run "${wf.name}": ${(err as Error).message}`);
    }
  };

  const handleStop = async (wf: WorkflowModel) => {
    try {
      const activeExecId = activeWorkflowRuns[wf.id];
      if (activeExecId) {
        await api.stopExecution(activeExecId);
      } else {
        await api.stopWorkflow(wf.id);
      }
      onLog('error', `Stopped "${wf.name}"`);
      await loadWorkflows();
    } catch (err) {
      onLog('error', `Failed to stop "${wf.name}": ${(err as Error).message}`);
    }
  };

  const handleClone = async (wf: WorkflowModel) => {
    try {
      const cloned = await api.cloneWorkflow(wf.id);
      onLog('success', `Cloned "${wf.name}" -> "${cloned.name}" (#${cloned.id})`);
      await loadWorkflows();
    } catch (err) {
      onLog('error', `Clone failed: ${(err as Error).message}`);
    }
  };

  const handleToggleActive = async (wf: WorkflowModel) => {
    try {
      await api.updateWorkflow(wf.id, { is_active: !wf.is_active });
      onLog('info', `${wf.is_active ? 'Paused' : 'Activated'} "${wf.name}"`);
      await loadWorkflows();
    } catch (err) {
      onLog('error', `Update failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (wf: WorkflowModel) => {
    try {
      await api.deleteWorkflow(wf.id);
      onLog('info', `Deleted "${wf.name}"`);
      await loadWorkflows();
    } catch (err) {
      onLog('error', `Delete failed: ${(err as Error).message}`);
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

  const filtered = workflows.filter(wf => {
    if (filterMode !== 'all' && wf.mode !== filterMode) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        wf.name.toLowerCase().includes(q) ||
        (wf.description ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Saved Scripts & Blueprints</h2>
          <p className="page-subtitle">
            Run, stop, edit, clone, schedule, or inspect execution history for server-side Lua workflows.
          </p>
        </div>

        <div className="toolbar-group" style={{ flexWrap: 'wrap' }}>
          <input
            placeholder="Search scripts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '210px' }}
          />
          <select
            value={filterMode}
            onChange={e => setFilterMode(e.target.value as 'all' | 'blueprint' | 'code')}
          >
            <option value="all">All Types</option>
            <option value="blueprint">Blueprints</option>
            <option value="code">Code Scripts</option>
          </select>
          <button type="button" onClick={() => void loadWorkflows()}>
            Refresh
          </button>
          <button type="button" className="btn-accent" onClick={onCreateNew}>
            + New Script
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && workflows.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>Loading scripts from server...</div>
      ) : filtered.length === 0 ? (
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
          {filtered.map(wf => {
            const runningExecId = activeWorkflowRuns[wf.id];
            const status = runningExecId ? 'running' : wf.latest_execution?.status ?? 'idle';
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
                    disabled={status === 'running'}
                    onClick={() => void handleRun(wf)}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={status !== 'running'}
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
