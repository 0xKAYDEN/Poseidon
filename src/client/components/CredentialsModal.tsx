import React, { useEffect, useState } from 'react';
import type { ApiClient } from '../api';

interface CredentialsModalProps {
  api: ApiClient;
  onClose: () => void;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({ api, onClose }) => {
  const [items, setItems] = useState<Array<{ id: number; name: string; type: string; created_at: string }>>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('api_key');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getCredentials()
      .then(setItems)
      .catch(err => setError((err as Error).message));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !value.trim()) return;
    try {
      await api.saveCredential(name.trim(), type, { value: value.trim() });
      setName('');
      setValue('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    await api.deleteCredential(id);
    load();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: '14px' }}>Encrypted Credential Vault</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            Secrets are encrypted with AES-256-GCM at rest and exposed inside Lua nodes via{' '}
            <span className="mono">context.secrets[name].value</span>.
          </p>

          {error && <div className="form-error">{error}</div>}

          <form onSubmit={handleSave} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              placeholder="Credential name (e.g. openai_key)"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ flex: 1, minWidth: '160px' }}
              required
            />
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="api_key">api_key</option>
              <option value="http_basic">http_basic</option>
              <option value="oauth2">oauth2</option>
              <option value="mysql">mysql</option>
            </select>
            <input
              type="password"
              placeholder="Secret value"
              value={value}
              onChange={e => setValue(e.target.value)}
              style={{ flex: 1, minWidth: '160px' }}
              required
            />
            <button type="submit" className="btn-accent">Save Secret</button>
          </form>

          <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', marginTop: '4px' }}>
            {items.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '18px', textAlign: 'center' }}>
                No encrypted credentials stored yet.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Created</th>
                    <th style={{ width: '90px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td className="mono">{item.name}</td>
                      <td className="mono" style={{ color: 'var(--text-secondary)' }}>{item.type}</td>
                      <td className="mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {new Date(item.created_at).toLocaleTimeString()}
                      </td>
                      <td>
                        <button type="button" className="btn-danger" style={{ padding: '3px 8px', fontSize: '11.5px' }} onClick={() => handleDelete(item.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
