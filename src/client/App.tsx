import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from './api';
import { SecureClientChannel } from './crypto/secureClientChannel';
import { AIProvidersPage } from './components/AIProvidersPage';
import { AuditFilesPage } from './components/AuditFilesPage';
import { ConnectionsPage } from './components/ConnectionsPage';
import { CredentialsModal } from './components/CredentialsModal';
import { DatabasePage } from './components/DatabasePage';
import { LoginPage } from './components/LoginPage';
import { ScriptsPage } from './components/ScriptsPage';
import { StudioPage } from './components/StudioPage';
import type { LogEntry, ScriptTemplate, WorkflowModel } from './types';

type ActiveTab = 'studio' | 'scripts' | 'providers' | 'connections' | 'database' | 'audit';

function nowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

function readStorage(key: string): string | null {
  try {
    const local = localStorage.getItem(key);
    if (local !== null) return local;
  } catch {
    // ignore storage restriction
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage restriction
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore storage restriction
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage restriction
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore storage restriction
  }
}

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => readStorage('poseidon_jwt'));
  const [username, setUsername] = useState<string>(() => readStorage('poseidon_user') || 'testadmin');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowModel | null>(null);
  const [draftTemplate, setDraftTemplate] = useState<ScriptTemplate | null>(null);
  const [wsEncrypted, setWsEncrypted] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'init',
      timestamp: nowTime(),
      level: 'info',
      message: 'Poseidon Studio initialized.'
    }
  ]);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, string>>({});
  const [activeWorkflowRuns, setActiveWorkflowRuns] = useState<Record<number, number[]>>({});

  const channelRef = useRef<SecureClientChannel | null>(null);
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;
  const freshLoginTokenRef = useRef<string | null>(null);
  const loggedFinishedExecsRef = useRef<Set<number>>(new Set());

  const clearSessionState = useCallback((notice?: string) => {
    freshLoginTokenRef.current = null;
    tokenRef.current = null;
    removeStorage('poseidon_jwt');
    removeStorage('poseidon_user');
    setSessionNotice(notice ?? null);
    setActiveWorkflowRuns({});
    setToken(null);
  }, []);

  const api = useMemo(
    () =>
      new ApiClient(
        () => tokenRef.current,
        usedToken => {
          if (usedToken === tokenRef.current) {
            clearSessionState('Session rejected by server (401). Please sign in again.');
          }
        }
      ),
    [clearSessionState]
  );

  const handleLogout = useCallback(() => {
    void api.logout().catch(() => {});
    clearSessionState();
  }, [api, clearSessionState]);

  const appendLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs(prev => [
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: nowTime(),
        level,
        message
      },
      ...prev.slice(0, 249)
    ]);
  }, []);

  const markRunStarted = useCallback((executionId: number, workflowId: number) => {
    if (!Number.isFinite(executionId) || !Number.isFinite(workflowId)) return;
    setActiveWorkflowRuns(prev => {
      const existing = prev[workflowId] ?? [];
      if (existing.includes(executionId)) return prev;
      return { ...prev, [workflowId]: [...existing, executionId] };
    });
  }, []);

  const markRunFinished = useCallback(
    (executionId: number, workflowId: number, status?: string, errorMsg?: string | null) => {
      setActiveWorkflowRuns(prev => {
        const existing = prev[workflowId];
        if (!existing) return prev;
        const filtered = existing.filter(id => id !== executionId);
        if (filtered.length === existing.length) return prev;
        const next = { ...prev };
        if (filtered.length === 0) {
          delete next[workflowId];
        } else {
          next[workflowId] = filtered;
        }
        return next;
      });

      if (status && !loggedFinishedExecsRef.current.has(executionId)) {
        loggedFinishedExecsRef.current.add(executionId);
        if (loggedFinishedExecsRef.current.size > 500) {
          const oldest = loggedFinishedExecsRef.current.values().next().value;
          if (oldest !== undefined) loggedFinishedExecsRef.current.delete(oldest);
        }
        if (status === 'completed') {
          appendLog('success', `Execution #${executionId} completed.`);
        } else {
          appendLog('error', `Execution #${executionId} ${status}${errorMsg ? `: ${errorMsg}` : ''}`);
        }
      }
    },
    [appendLog]
  );

  const handleExecutionStopped = useCallback((workflowId: number, executionId?: number) => {
    setActiveWorkflowRuns(prev => {
      if (!(workflowId in prev)) return prev;
      const next = { ...prev };
      if (executionId !== undefined) {
        const filtered = next[workflowId].filter(id => id !== executionId);
        if (filtered.length === 0) {
          delete next[workflowId];
        } else {
          next[workflowId] = filtered;
        }
      } else {
        delete next[workflowId];
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!token) {
      channelRef.current?.disconnect();
      channelRef.current = null;
      setWsEncrypted(false);
      return;
    }

    const channel = new SecureClientChannel();
    channelRef.current = channel;

    const unsubStatus = channel.onStatusChange(enc => setWsEncrypted(enc));
    const unsubEvent = channel.onEvent(msg => {
      const type = String(msg.type ?? '');
      if (type === 'execution_started') {
        const execId = Number(msg.execution_id);
        const wfId = Number(msg.workflow_id);
        markRunStarted(execId, wfId);
      } else if (type === 'step') {
        const clientId = String(msg.client_id ?? '');
        const status = String(msg.status ?? '');
        const nodeName = String(msg.node_name ?? msg.node_id ?? '');
        if (clientId) {
          setNodeStatuses(prev => ({ ...prev, [clientId]: status }));
        }
        if (status === 'completed') {
          appendLog('step', `Step "${nodeName}" completed (${msg.duration_ms ?? 0}ms) -> ${msg.output ?? '{}'}`);
        } else if (status === 'failed') {
          appendLog('error', `Step "${nodeName}" failed: ${msg.error ?? 'error'}`);
        } else if (status === 'running') {
          appendLog('info', `Running step "${nodeName}"...`);
        }
      } else if (type === 'flow_log') {
        appendLog('info', String(msg.message ?? ''));
      } else if (type === 'flow_event') {
        appendLog('step', `Event [${String(msg.event ?? 'custom')}]: ${JSON.stringify(msg.payload ?? {})}`);
      } else if (type === 'execution_finished') {
        const execId = Number(msg.execution_id);
        const wfId = Number(msg.workflow_id);
        const status = String(msg.status ?? '');
        const errorMsg = msg.error ? String(msg.error) : null;
        markRunFinished(execId, wfId, status, errorMsg);
      } else if (type === 'error') {
        appendLog('error', `Server error: ${String(msg.error ?? 'unknown')}`);
      }
    });

    channel
      .connect(token)
      .then(() => {
        appendLog('success', 'Encrypted WebSocket established (X25519 + AES-256-GCM).');
      })
      .catch(err => {
        appendLog('error', `WebSocket handshake failed: ${(err as Error).message}`);
      });

    return () => {
      unsubStatus();
      unsubEvent();
      channel.disconnect();
    };
  }, [token, appendLog, markRunStarted, markRunFinished]);

  const handleLoginSuccess = (newToken: string, user: string) => {
    freshLoginTokenRef.current = newToken;
    tokenRef.current = newToken;
    writeStorage('poseidon_jwt', newToken);
    writeStorage('poseidon_user', user);
    setSessionNotice(null);
    setToken(newToken);
    setUsername(user);
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    if (freshLoginTokenRef.current === token) {
      freshLoginTokenRef.current = null;
    } else {
      api
        .getMe()
        .then(me => {
          if (!cancelled && me.username) {
            setUsername(me.username);
          }
        })
        .catch(() => {
          // 401 is handled centrally by ApiClient.onUnauthorized
        });
    }

    // Hydrate any already-running executions on the server (e.g. schedule/webhook or reload)
    api
      .getExecutions()
      .then(list => {
        if (cancelled) return;
        const next: Record<number, number[]> = {};
        for (const ex of list) {
          if (ex.status === 'running' || ex.status === 'queued') {
            if (!next[ex.workflow_id]) next[ex.workflow_id] = [];
            next[ex.workflow_id].push(ex.id);
          }
        }
        if (Object.keys(next).length > 0) {
          setActiveWorkflowRuns(prev => {
            const merged: Record<number, number[]> = { ...prev };
            for (const [wfIdStr, ids] of Object.entries(next)) {
              const wfId = Number(wfIdStr);
              const existing = merged[wfId] ?? [];
              merged[wfId] = Array.from(new Set([...existing, ...ids]));
            }
            return merged;
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [api, token]);

  const hasActiveRuns = Object.keys(activeWorkflowRuns).length > 0;
  useEffect(() => {
    if (!token || !hasActiveRuns) return;
    let cancelled = false;
    let inFlight = false;

    const syncExecutions = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const list = await api.getExecutions();
        if (cancelled) return;
        const byId = new Map(list.map(e => [e.id, e]));

        for (const ex of list) {
          if (ex.status === 'running' || ex.status === 'queued') {
            markRunStarted(ex.id, ex.workflow_id);
          }
        }

        setActiveWorkflowRuns(prev => {
          let changed = false;
          const next: Record<number, number[]> = {};
          for (const [wfIdStr, ids] of Object.entries(prev)) {
            const wfId = Number(wfIdStr);
            const stillActive: number[] = [];
            for (const execId of ids) {
              const srv = byId.get(execId);
              if (!srv || srv.status === 'running' || srv.status === 'queued') {
                stillActive.push(execId);
              } else {
                changed = true;
                if (!loggedFinishedExecsRef.current.has(execId)) {
                  loggedFinishedExecsRef.current.add(execId);
                  if (srv.status === 'completed') {
                    appendLog('success', `Execution #${execId} completed.`);
                  } else {
                    appendLog('error', `Execution #${execId} ${srv.status}${srv.error ? `: ${srv.error}` : ''}`);
                  }
                }
              }
            }
            if (stillActive.length > 0) {
              next[wfId] = stillActive;
            }
          }
          return changed ? next : prev;
        });
      } catch {
        // ignore transient poll errors
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      void syncExecutions();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, token, hasActiveRuns, markRunStarted, appendLog]);

  const handleExecutionStarted = useCallback(
    (executionId: number, workflowId: number) => {
      markRunStarted(executionId, workflowId);
    },
    [markRunStarted]
  );

  const totalActiveRuns = Object.values(activeWorkflowRuns).reduce((acc, ids) => acc + ids.length, 0);

  if (!token) {
    return <LoginPage api={api} initialError={sessionNotice} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        {/* Zone 1: Single-element Brand Wordmark */}
        <span className="brand-wordmark">Poseidon</span>

        {/* Zone 2: Concise single-line nav links */}
        <nav className="primary-nav" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-link ${activeTab === 'studio' ? 'active' : ''}`}
            onClick={() => setActiveTab('studio')}
          >
            Studio
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'scripts' ? 'active' : ''}`}
            onClick={() => setActiveTab('scripts')}
          >
            Scripts
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'providers' ? 'active' : ''}`}
            onClick={() => setActiveTab('providers')}
          >
            AI Providers
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'connections' ? 'active' : ''}`}
            onClick={() => setActiveTab('connections')}
          >
            Connections
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'database' ? 'active' : ''}`}
            onClick={() => setActiveTab('database')}
          >
            Database
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Audit & Files
          </button>
        </nav>

        {/* Zone 3: Telemetry & User Action */}
        <div className="header-actions">
          {totalActiveRuns > 0 && (
            <button
              type="button"
              className="status-text running"
              style={{ border: '1px solid var(--border-subtle)', padding: '3px 8px', borderRadius: '4px' }}
              onClick={() => setActiveTab('scripts')}
              title="View or stop currently running scripts"
            >
              {totalActiveRuns} running
            </button>
          )}
          <span className="ws-telemetry">
            <span className={`ws-dot ${wsEncrypted ? 'online' : ''}`} />
            {wsEncrypted ? 'Encrypted Channel' : 'Connecting'}
          </span>
          <button type="button" onClick={() => setShowCredentials(true)}>
            Vault
          </button>
          <span className="user-meta">{username}</span>
          <button type="button" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      {activeTab === 'studio' && (
        <StudioPage
          api={api}
          editingWorkflow={editingWorkflow}
          draftTemplate={draftTemplate}
          onConsumeDraftTemplate={() => setDraftTemplate(null)}
          nodeStatuses={nodeStatuses}
          activeWorkflowRuns={activeWorkflowRuns}
          logs={logs}
          onLog={appendLog}
          onClearLogs={() => setLogs([])}
          onSaved={wf => setEditingWorkflow(wf)}
          onExecutionStarted={handleExecutionStarted}
          onExecutionStopped={handleExecutionStopped}
          onResetRunState={() => setNodeStatuses({})}
        />
      )}

      {activeTab === 'scripts' && (
        <ScriptsPage
          api={api}
          activeWorkflowRuns={activeWorkflowRuns}
          onEditWorkflow={wf => {
            if (
              wf.latest_execution &&
              (wf.latest_execution.status === 'running' || wf.latest_execution.status === 'queued')
            ) {
              markRunStarted(wf.latest_execution.id, wf.id);
            }
            setEditingWorkflow(wf);
            setNodeStatuses({});
            setActiveTab('studio');
          }}
          onUseTemplate={tpl => {
            setEditingWorkflow(null);
            setDraftTemplate(tpl);
            setNodeStatuses({});
            setActiveTab('studio');
          }}
          onCreateNew={() => {
            setEditingWorkflow(null);
            setNodeStatuses({});
            setActiveTab('studio');
          }}
          onLog={appendLog}
          onExecutionStarted={handleExecutionStarted}
          onExecutionStopped={handleExecutionStopped}
        />
      )}

      {activeTab === 'providers' && <AIProvidersPage api={api} onLog={appendLog} />}

      {activeTab === 'connections' && <ConnectionsPage api={api} onLog={appendLog} />}

      {activeTab === 'database' && <DatabasePage api={api} onLog={appendLog} />}

      {activeTab === 'audit' && <AuditFilesPage api={api} />}

      {showCredentials && <CredentialsModal api={api} onClose={() => setShowCredentials(false)} />}
    </div>
  );
};
