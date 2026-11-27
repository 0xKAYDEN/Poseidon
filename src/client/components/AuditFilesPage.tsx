import React, { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import type { AuditLogItem, SandboxFileItem } from '../types';

interface AuditFilesPageProps {
  api: ApiClient;
}

export const AuditFilesPage: React.FC<AuditFilesPageProps> = ({ api }) => {
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [files, setFiles] = useState<SandboxFileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<SandboxFileItem | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'audit' | 'files'>('audit');

  const load = useCallback(async () => {
    const [audits, fsList] = await Promise.all([api.getAuditLogs(), api.getSandboxFiles()]);
    setAuditLogs(audits);
    setFiles(fsList);
    if (!selectedFile && fsList[0]) {
      setSelectedFile(fsList[0]);
      setFileContent(fsList[0].content);
    }
  }, [api, selectedFile]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetName = selectedFile ? selectedFile.name : newFileName.trim();
    if (!targetName) return;
    const saved = await api.saveSandboxFile(targetName, fileContent);
    setNewFileName('');
    setSelectedFile(saved);
    const updated = await api.getSandboxFiles();
    setFiles(updated);
  };

  const handleDeleteFile = async (name: string) => {
    await api.deleteSandboxFile(name);
    if (selectedFile?.name === name) {
      setSelectedFile(null);
      setFileContent('');
    }
    const updated = await api.getSandboxFiles();
    setFiles(updated);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail & Sandbox Storage</h1>
          <p className="page-subtitle">
            Inspect security and execution audit logs alongside sandboxed files accessed by Lua fs.read and fs.write.
          </p>
        </div>

        <div className="segmented-control" style={{ width: '280px' }}>
          <button
            type="button"
            className={activeSubTab === 'audit' ? 'active' : ''}
            onClick={() => setActiveSubTab('audit')}
          >
            Audit Log ({auditLogs.length})
          </button>
          <button
            type="button"
            className={activeSubTab === 'files' ? 'active' : ''}
            onClick={() => setActiveSubTab('files')}
          >
            Sandbox Files ({files.length})
          </button>
        </div>
      </div>

      {activeSubTab === 'audit' ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '70px' }}>ID</th>
                <th style={{ width: '170px' }}>Event</th>
                <th style={{ width: '130px' }}>Actor</th>
                <th>Details</th>
                <th style={{ width: '170px' }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map(item => (
                <tr key={item.id}>
                  <td className="mono tabular-nums">{item.id}</td>
                  <td className="mono" style={{ color: '#93c5fd' }}>{item.event_type}</td>
                  <td>{item.actor}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 'none' }}>{item.details}</td>
                  <td className="mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {new Date(item.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px', flex: 1, minHeight: 0 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12.5px' }}>Files</strong>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setNewFileName('');
                  setFileContent('');
                }}
              >
                + New File
              </button>
            </div>
            {files.map(f => (
              <div
                key={f.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 9px',
                  borderRadius: '5px',
                  background: selectedFile?.name === f.name ? 'var(--accent-soft)' : 'var(--bg)',
                  border: `1px solid ${selectedFile?.name === f.name ? 'var(--accent)' : 'var(--border)'}`,
                  cursor: 'pointer'
                }}
                onClick={() => {
                  setSelectedFile(f);
                  setFileContent(f.content);
                }}
              >
                <span className="mono" style={{ fontSize: '12px' }}>{f.name}</span>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: '2px 6px', fontSize: '11px', color: '#fca5a5' }}
                  onClick={e => {
                    e.stopPropagation();
                    void handleDeleteFile(f.name);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleSaveFile}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {selectedFile ? (
                <strong className="mono">{selectedFile.name}</strong>
              ) : (
                <input
                  placeholder="Filename (e.g. notes.txt)"
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  className="mono"
                  required
                />
              )}
              <button type="submit" className="btn-accent" style={{ marginLeft: 'auto' }}>
                Save File
              </button>
            </div>
            <textarea
              className="lua-textarea"
              value={fileContent}
              onChange={e => setFileContent(e.target.value)}
              placeholder="File content..."
            />
          </form>
        </div>
      )}
    </div>
  );
};
