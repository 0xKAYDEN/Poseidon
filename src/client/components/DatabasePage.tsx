import React, { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import type { LogEntry, TableSummary } from '../types';

interface DatabasePageProps {
  api: ApiClient;
  onLog: (level: LogEntry['level'], message: string) => void;
}

export const DatabasePage: React.FC<DatabasePageProps> = ({ api, onLog }) => {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('items');
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [tableRows, setTableRows] = useState<Array<Record<string, unknown>>>([]);
  const [tableKind, setTableKind] = useState<'system' | 'custom'>('custom');

  const [sql, setSql] = useState('SELECT id, sku, title, category, stock, status FROM items ORDER BY id ASC');
  const [sqlResultMsg, setSqlResultMsg] = useState<string | null>(null);
  const [sqlDuration, setSqlDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Create table modal
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableCols, setNewTableCols] = useState('name, value, status');

  // Insert row form
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});

  const loadTables = useCallback(async () => {
    try {
      const list = await api.getDbTables();
      setTables(list);
      return list;
    } catch (err) {
      setError((err as Error).message);
      return [];
    }
  }, [api]);

  const loadTableData = useCallback(
    async (name: string) => {
      setLoading(true);
      setError(null);
      setSqlResultMsg(null);
      try {
        const res = await api.getDbTableData(name);
        setSelectedTable(res.meta.name);
        setTableKind(res.meta.kind);
        setTableColumns(res.meta.columns);
        setTableRows(res.rows);
        setSql(`SELECT * FROM ${res.meta.name} LIMIT 50`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    void loadTables().then(list => {
      if (list.length > 0) {
        const defaultTbl = list.find(t => t.name === 'items')?.name ?? list[0].name;
        void loadTableData(defaultTbl);
      }
    });
  }, [loadTables, loadTableData]);

  const handleRunSql = async () => {
    setError(null);
    setSqlResultMsg(null);
    setLoading(true);
    try {
      const res = await api.runSql(sql);
      setSqlDuration(res.durationMs);
      if (res.columns.length > 0 || res.rows.length > 0) {
        setTableColumns(res.columns.length > 0 ? res.columns : Object.keys(res.rows[0] ?? {}));
        setTableRows(res.rows);
        setSqlResultMsg(`${res.rows.length} row(s) returned`);
      } else {
        setSqlResultMsg(res.message || `${res.affectedRows} row(s) affected`);
        await loadTables();
        await loadTableData(selectedTable);
      }
      onLog('success', `SQL executed (${res.durationMs}ms): ${sql.trim().slice(0, 80)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cols = newTableCols
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (!newTableName.trim() || cols.length === 0) return;
    try {
      const created = await api.createDbTable(newTableName.trim(), cols);
      setShowCreateTable(false);
      setNewTableName('');
      await loadTables();
      await loadTableData(created.name);
      onLog('success', `Created table "${created.name}".`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDropTable = async () => {
    try {
      await api.dropDbTable(selectedTable);
      const list = await loadTables();
      if (list[0]) await loadTableData(list[0].name);
      onLog('info', `Dropped table "${selectedTable}".`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleInsertRow = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.insertDbRow(selectedTable, newRowValues);
      setNewRowValues({});
      setShowAddRow(false);
      await loadTables();
      await loadTableData(selectedTable);
      onLog('success', `Inserted row into "${selectedTable}".`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    try {
      await api.deleteDbRow(selectedTable, rowId);
      await loadTables();
      await loadTableData(selectedTable);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="db-layout">
      {/* Left Sidebar: Tables */}
      <aside className="db-sidebar">
        <div className="pane-header">
          <span>Database Tables</span>
          <button type="button" onClick={() => setShowCreateTable(true)} style={{ padding: '4px 8px', fontSize: '11.5px' }}>
            + Table
          </button>
        </div>

        <div className="db-table-list">
          {tables.map(tbl => (
            <button
              key={tbl.name}
              type="button"
              className={`db-table-item ${selectedTable === tbl.name ? 'active' : ''}`}
              onClick={() => void loadTableData(tbl.name)}
            >
              <span className="mono" style={{ fontSize: '12px' }}>
                {tbl.name}
              </span>
              <span className="tabular-nums" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {tbl.kind === 'custom' ? `${tbl.rowCount} rows` : `${tbl.rowCount} · sys`}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Area: SQL Query Console + Data Grid */}
      <main className="db-main">
        <section className="sql-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 600 }}>SQL Query Console</h2>
              <span className="meta-line">
                <span>Table: {selectedTable}</span>
                <span aria-hidden="true">·</span>
                <span>{tableKind === 'custom' ? 'Editable table' : 'System read-only'}</span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSql("INSERT INTO items (sku, title, category, stock, status) VALUES ('PSD-105', 'New Worker', 'Automation', 10, 'active')")}
              >
                Sample Insert
              </button>
              <button type="button" onClick={() => setSql('SHOW TABLES')}>
                Show Tables
              </button>
              {tableKind === 'custom' && (
                <>
                  <button type="button" onClick={() => setShowAddRow(true)}>
                    + Add Row
                  </button>
                  <button type="button" className="btn-danger" onClick={() => void handleDropTable()}>
                    Drop Table
                  </button>
                </>
              )}
              <button type="button" className="btn-accent" onClick={() => void handleRunSql()} disabled={loading}>
                Run SQL
              </button>
            </div>
          </div>

          <textarea
            className="sql-textarea"
            spellCheck={false}
            value={sql}
            onChange={e => setSql(e.target.value)}
            placeholder="SELECT * FROM items ORDER BY id ASC"
          />

          {error && <div className="form-error" style={{ marginBottom: 0 }}>{error}</div>}
          {sqlResultMsg && (
            <div style={{ fontSize: '12px', color: '#4ade80' }}>
              {sqlResultMsg}
              {sqlDuration !== null ? ` · ${sqlDuration}ms` : ''}
            </div>
          )}
        </section>

        {/* Data Grid */}
        <section className="data-grid-wrap">
          {loading ? (
            <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Loading table data...</div>
          ) : tableRows.length === 0 ? (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '32px',
                textAlign: 'center',
                color: 'var(--text-secondary)'
              }}
            >
              <p style={{ margin: '0 0 12px 0' }}>No rows found in this view.</p>
              {tableKind === 'custom' && (
                <button type="button" className="btn-accent" onClick={() => setShowAddRow(true)}>
                  Add First Row
                </button>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {tableColumns.map(col => (
                    <th key={col}>{col}</th>
                  ))}
                  {tableKind === 'custom' && <th style={{ width: '90px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, idx) => (
                  <tr key={String(row.id ?? idx)}>
                    {tableColumns.map(col => {
                      const val = row[col];
                      const display =
                        val === null || val === undefined
                          ? '—'
                          : typeof val === 'object'
                            ? JSON.stringify(val)
                            : String(val);
                      const isNumeric = typeof val === 'number';
                      return (
                        <td
                          key={col}
                          className={isNumeric ? 'mono tabular-nums' : ''}
                          title={display}
                        >
                          {display}
                        </td>
                      );
                    })}
                    {tableKind === 'custom' && (
                      <td>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '3px 8px', fontSize: '11.5px', color: '#fca5a5' }}
                          onClick={() => void handleDeleteRow(Number(row.id))}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {/* Create Table Modal */}
      {showCreateTable && (
        <div className="modal-backdrop" onClick={() => setShowCreateTable(false)}>
          <div className="modal-box" style={{ maxWidth: '460px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '14px' }}>Create Database Table</h3>
              <button type="button" onClick={() => setShowCreateTable(false)}>Close</button>
            </div>
            <form className="modal-body" onSubmit={handleCreateTable}>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Table Name</label>
                <input
                  value={newTableName}
                  onChange={e => setNewTableName(e.target.value)}
                  placeholder="e.g. customers"
                  required
                />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label>Columns (comma-separated, id added automatically)</label>
                <input
                  value={newTableCols}
                  onChange={e => setNewTableCols(e.target.value)}
                  placeholder="name, email, plan"
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowCreateTable(false)}>Cancel</button>
                <button type="submit" className="btn-accent">Create Table</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Insert Row Modal */}
      {showAddRow && (
        <div className="modal-backdrop" onClick={() => setShowAddRow(false)}>
          <div className="modal-box" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '14px' }}>Insert Row into {selectedTable}</h3>
              <button type="button" onClick={() => setShowAddRow(false)}>Close</button>
            </div>
            <form className="modal-body" onSubmit={handleInsertRow}>
              {tableColumns
                .filter(c => c !== 'id' && c !== 'created_at' && c !== 'updated_at')
                .map(col => (
                  <div key={col} className="form-field" style={{ marginBottom: 0 }}>
                    <label>{col}</label>
                    <input
                      value={newRowValues[col] ?? ''}
                      onChange={e => setNewRowValues(prev => ({ ...prev, [col]: e.target.value }))}
                      placeholder={`Enter ${col}`}
                    />
                  </div>
                ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowAddRow(false)}>Cancel</button>
                <button type="submit" className="btn-accent">Insert Row</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
