import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from './api';
import { SecureClientChannel } from './crypto/secureClientChannel';
import { AuditFilesPage } from './components/AuditFilesPage';
import { CredentialsModal } from './components/CredentialsModal';
import { DatabasePage } from './components/DatabasePage';
import { LoginPage } from './components/LoginPage';
import { ScriptsPage } from './components/ScriptsPage';
import { StudioPage } from './components/StudioPage';
import type { LogEntry, WorkflowModel } from './types';

type ActiveTab = 'studio' | 'scripts' | 'database' | 'audit';

function nowTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('poseidon_jwt'));
  const [username, setUsername] = useState<string>(() => sessionStorage.getItem('poseidon_user') || 'admin');
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowModel | null>(null);
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
  const [activeWorkflowRuns, setActiveWorkflowRuns] = useState<Record<number, number>>({});
  const [studioExecutionId, setStudioExecutionId] = useState<number | null>(null);

  const channelRef = useRef<SecureClientChannel | null>(null);
  const api = useMemo(() => new ApiClient(() => token), [token]);

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
      if (type === 'step') {
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
      } else if (type === 'execution_finished') {
        const execId = Number(msg.execution_id);
        const wfId = Number(msg.workflow_id);
        const status = String(msg.status ?? '');
        setActiveWorkflowRuns(prev => {
          const next = { ...prev };
          if (next[wfId] === execId) delete next[wfId];
          return next;
        });
        setStudioExecutionId(prev => (prev === execId ? null : prev));
        if (status === 'completed') {
          appendLog('success', `Execution #${execId} completed.`);
        } else {
          appendLog('error', `Execution #${execId} ${status}${msg.error ? `: ${msg.error}` : ''}`);
        }
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
  }, [token, appendLog]);

  const handleLoginSuccess = (newToken: string, user: string) => {
    sessionStorage.setItem('poseidon_jwt', newToken);
    sessionStorage.setItem('poseidon_user', user);
    setToken(newToken);
    setUsername(user);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('poseidon_jwt');
    sessionStorage.removeItem('poseidon_user');
    setToken(null);
  };

  const handleExecutionStarted = useCallback((executionId: number, workflowId: number) => {
    setStudioExecutionId(executionId);
    setActiveWorkflowRuns(prev => ({ ...prev, [workflowId]: executionId }));
  }, []);

  if (!token) {
    return <LoginPage api={api} onLoginSuccess={handleLoginSuccess} />;
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
          nodeStatuses={nodeStatuses}
          activeExecutionId={studioExecutionId}
          logs={logs}
          onLog={appendLog}
          onClearLogs={() => setLogs([])}
          onSaved={wf => setEditingWorkflow(wf)}
          onExecutionStarted={handleExecutionStarted}
          onResetRunState={() => setNodeStatuses({})}
        />
      )}

      {activeTab === 'scripts' && (
        <ScriptsPage
          api={api}
          activeWorkflowRuns={activeWorkflowRuns}
          onEditWorkflow={wf => {
            setEditingWorkflow(wf);
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
        />
      )}

      {activeTab === 'database' && <DatabasePage api={api} onLog={appendLog} />}

      {activeTab === 'audit' && <AuditFilesPage api={api} />}

      {showCredentials && <CredentialsModal api={api} onClose={() => setShowCredentials(false)} />}
    </div>
  );
};
