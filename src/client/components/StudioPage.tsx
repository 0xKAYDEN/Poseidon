import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../api';
import {
  NODE_PALETTE,
  getDefaultScriptForType,
  type CanvasEdgeDraft,
  type CanvasNodeDraft,
  type EdgeCondition,
  type LogEntry,
  type NodeType,
  type ScriptTemplate,
  type TriggerMode,
  type WorkflowModel
} from '../types';

interface StudioPageProps {
  api: ApiClient;
  editingWorkflow: WorkflowModel | null;
  nodeStatuses: Record<string, string>;
  activeExecutionId: number | null;
  logs: LogEntry[];
  onLog: (level: LogEntry['level'], message: string) => void;
  onClearLogs: () => void;
  onSaved: (workflow: WorkflowModel) => void;
  onExecutionStarted: (executionId: number, workflowId: number) => void;
  onResetRunState: () => void;
}

function makeClientId(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export const StudioPage: React.FC<StudioPageProps> = ({
  api,
  editingWorkflow,
  nodeStatuses,
  activeExecutionId,
  logs,
  onLog,
  onClearLogs,
  onSaved,
  onExecutionStarted,
  onResetRunState
}) => {
  const [workflowId, setWorkflowId] = useState<number | null>(null);
  const [name, setName] = useState('New Automation Script');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'blueprint' | 'code'>('blueprint');
  const [triggerType, setTriggerType] = useState<TriggerMode>('manual');
  const [scheduleSeconds, setScheduleSeconds] = useState<number>(60);
  const [isActive, setIsActive] = useState<boolean>(true);

  const [nodes, setNodes] = useState<CanvasNodeDraft[]>([
    {
      clientId: 'n_start',
      type: 'code',
      name: 'MAIN SCRIPT',
      x: 160,
      y: 140,
      script: getDefaultScriptForType('code')
    }
  ]);
  const [edges, setEdges] = useState<CanvasEdgeDraft[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('n_start');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedPaletteType, setSelectedPaletteType] = useState<NodeType>('code');
  const [inputJsonText, setInputJsonText] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<ScriptTemplate[]>([]);

  // Canvas viewport state
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [draggingPan, setDraggingPan] = useState<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [draggingNode, setDraggingNode] = useState<{
    clientId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<{
    sourceClientId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  useEffect(() => {
    api.getScripts().then(setTemplates).catch(() => {});
  }, [api]);

  // Hydrate when editingWorkflow changes
  useEffect(() => {
    if (!editingWorkflow) return;
    setWorkflowId(editingWorkflow.id);
    setName(editingWorkflow.name);
    setDescription(editingWorkflow.description ?? '');
    setMode(editingWorkflow.mode);
    setTriggerType(editingWorkflow.trigger_type ?? 'manual');
    setScheduleSeconds(editingWorkflow.schedule_seconds ?? 60);
    setIsActive(editingWorkflow.is_active ?? true);

    const serverIdToClientId = new Map<number, string>();
    const mappedNodes: CanvasNodeDraft[] = editingWorkflow.nodes.map((n, idx) => {
      const cid = n.client_id || `n_${n.id || idx}`;
      serverIdToClientId.set(n.id, cid);
      return {
        clientId: cid,
        serverId: n.id,
        type: n.type,
        name: n.name,
        x: n.position_x,
        y: n.position_y,
        script: n.script
      };
    });

    const mappedEdges: CanvasEdgeDraft[] = editingWorkflow.edges
      .map(e => {
        const src = serverIdToClientId.get(e.source_node_id);
        const tgt = serverIdToClientId.get(e.target_node_id);
        if (!src || !tgt) return null;
        return {
          id: `e_${e.id}`,
          sourceClientId: src,
          targetClientId: tgt,
          condition: e.condition_type
        };
      })
      .filter((x): x is CanvasEdgeDraft => x !== null);

    setNodes(mappedNodes);
    setEdges(mappedEdges);
    setSelectedNodeId(mappedNodes[0]?.clientId ?? null);
    setSelectedEdgeId(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [editingWorkflow]);

  const selectedNode = useMemo(
    () => nodes.find(n => n.clientId === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find(e => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  const handleNew = () => {
    const starterId = makeClientId('n');
    setWorkflowId(null);
    setName('Untitled Lua Script');
    setDescription('');
    setTriggerType('manual');
    setScheduleSeconds(60);
    setIsActive(true);
    setNodes([
      {
        clientId: starterId,
        type: 'code',
        name: 'MAIN SCRIPT',
        x: 160,
        y: 140,
        script: getDefaultScriptForType('code')
      }
    ]);
    setEdges([]);
    setSelectedNodeId(starterId);
    setSelectedEdgeId(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    onResetRunState();
    onLog('info', 'Created new draft workspace.');
  };

  const addNode = useCallback(
    (type: string, x: number, y: number) => {
      const id = makeClientId('n');
      const paletteItem = NODE_PALETTE.find(p => p.type === type);
      const label = (paletteItem?.label || type.replace('_', ' ')).toUpperCase();
      const newNode: CanvasNodeDraft = {
        clientId: id,
        type,
        name: label,
        x: Math.round(x),
        y: Math.round(y),
        script: getDefaultScriptForType(type)
      };
      setNodes(prev => [...prev, newNode]);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      onLog('info', `Added node: ${label} (${type})`);
    },
    [onLog]
  );

  const updateSelectedNode = (patch: Partial<CanvasNodeDraft>) => {
    if (!selectedNode) return;
    setNodes(prev =>
      prev.map(n => (n.clientId === selectedNode.clientId ? { ...n, ...patch } : n))
    );
  };

  const handleDeleteSelected = () => {
    if (selectedEdgeId) {
      setEdges(prev => prev.filter(e => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      return;
    }
    if (!selectedNode) return;
    if (mode === 'code' && nodes.length <= 1) return;
    const targetId = selectedNode.clientId;
    setNodes(prev => prev.filter(n => n.clientId !== targetId));
    setEdges(prev => prev.filter(e => e.sourceClientId !== targetId && e.targetClientId !== targetId));
    setSelectedNodeId(null);
  };

  const handleAutoLayout = () => {
    if (nodes.length === 0) return;
    const depth = new Map<string, number>();
    const incoming = new Map<string, string[]>();
    for (const n of nodes) {
      depth.set(n.clientId, 0);
      incoming.set(n.clientId, []);
    }
    for (const e of edges) {
      incoming.get(e.targetClientId)?.push(e.sourceClientId);
    }

    // Relax topological levels
    for (let pass = 0; pass < nodes.length; pass++) {
      for (const e of edges) {
        const srcD = depth.get(e.sourceClientId) ?? 0;
        const tgtD = depth.get(e.targetClientId) ?? 0;
        if (srcD + 1 > tgtD) {
          depth.set(e.targetClientId, srcD + 1);
        }
      }
    }

    const columns = new Map<number, CanvasNodeDraft[]>();
    for (const n of nodes) {
      const col = depth.get(n.clientId) ?? 0;
      const list = columns.get(col) ?? [];
      list.push(n);
      columns.set(col, list);
    }

    const nextPositions = new Map<string, { x: number; y: number }>();
    for (const [col, list] of columns.entries()) {
      list.forEach((node, idx) => {
        nextPositions.set(node.clientId, {
          x: 80 + col * 270,
          y: 80 + idx * 120
        });
      });
    }

    setNodes(prev =>
      prev.map(n => {
        const pos = nextPositions.get(n.clientId);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
      })
    );
    setPan({ x: 0, y: 0 });
  };

  const persistWorkflow = async (): Promise<WorkflowModel> => {
    const effectiveNodes =
      mode === 'code'
        ? [
            selectedNode ?? {
              clientId: 'code1',
              type: 'code',
              name: name || 'Main Script',
              x: 160,
              y: 140,
              script: getDefaultScriptForType('code')
            }
          ]
        : nodes;

    const payload = {
      name: name.trim() || 'Untitled Workflow',
      description: description.trim() || null,
      mode,
      trigger_type: triggerType,
      schedule_seconds: triggerType === 'schedule' ? Math.max(5, scheduleSeconds || 60) : null,
      is_active: isActive,
      nodes: effectiveNodes.map(n => ({
        client_id: n.clientId,
        type: n.type,
        name: n.name,
        script: n.script,
        x: n.x,
        y: n.y
      })),
      edges:
        mode === 'code'
          ? []
          : edges.map(e => ({
              source: e.sourceClientId,
              target: e.targetClientId,
              condition: e.condition
            }))
    };

    const saved = workflowId
      ? await api.updateWorkflow(workflowId, payload)
      : await api.createWorkflow(payload);

    setWorkflowId(saved.id);
    onSaved(saved);
    return saved;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await persistWorkflow();
      onLog('success', `Saved "${saved.name}" (ID #${saved.id}) to Poseidon server.`);
    } catch (err) {
      onLog('error', `Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    let parsedInputs: Record<string, unknown> = {};
    if (inputJsonText.trim()) {
      try {
        parsedInputs = JSON.parse(inputJsonText) as Record<string, unknown>;
      } catch {
        onLog('error', 'Input JSON is invalid.');
        return;
      }
    }

    onResetRunState();
    setSaving(true);
    try {
      const saved = await persistWorkflow();
      onLog('info', `Sending "${saved.name}" (#${saved.id}) to server for execution...`);
      const res = await api.executeWorkflow(saved.id, parsedInputs);
      onExecutionStarted(res.executionId, saved.id);
    } catch (err) {
      onLog('error', `Execute failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleStop = async () => {
    if (!activeExecutionId) return;
    try {
      await api.stopExecution(activeExecutionId);
      onLog('error', `Stop requested for execution #${activeExecutionId}.`);
    } catch (err) {
      onLog('error', `Stop failed: ${(err as Error).message}`);
    }
  };

  const handleSwitchMode = (nextMode: 'blueprint' | 'code') => {
    setMode(nextMode);
    if (nextMode === 'code' && !selectedNode && nodes.length > 0) {
      setSelectedNodeId(nodes[0].clientId);
    }
  };

  // Mouse handlers on canvas (scale-aware)
  const getCanvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvasBg) return;
    setSelectedEdgeId(null);
    setDraggingPan({
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingPan) {
      setPan({
        x: draggingPan.origX + (e.clientX - draggingPan.startX),
        y: draggingPan.origY + (e.clientY - draggingPan.startY)
      });
      return;
    }
    if (draggingNode) {
      const pt = getCanvasPoint(e.clientX, e.clientY);
      const nextX = Math.max(0, Math.round(pt.x - draggingNode.offsetX));
      const nextY = Math.max(0, Math.round(pt.y - draggingNode.offsetY));
      setNodes(prev =>
        prev.map(n => (n.clientId === draggingNode.clientId ? { ...n, x: nextX, y: nextY } : n))
      );
      return;
    }
    if (connectingFrom) {
      const pt = getCanvasPoint(e.clientX, e.clientY);
      setConnectingFrom(prev => (prev ? { ...prev, mouseX: pt.x, mouseY: pt.y } : null));
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingPan(null);
    setDraggingNode(null);
    setConnectingFrom(null);
  };

  const handleNodePortMouseUp = (targetClientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!connectingFrom) return;
    if (connectingFrom.sourceClientId !== targetClientId) {
      const exists = edges.some(
        edge =>
          edge.sourceClientId === connectingFrom.sourceClientId &&
          edge.targetClientId === targetClientId
      );
      if (!exists) {
        const newEdge: CanvasEdgeDraft = {
          id: makeClientId('e'),
          sourceClientId: connectingFrom.sourceClientId,
          targetClientId,
          condition: 'on_success'
        };
        setEdges(prev => [...prev, newEdge]);
        onLog('info', 'Connected nodes.');
      }
    }
    setConnectingFrom(null);
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/poseidon-node');
    if (!type) return;
    const pt = getCanvasPoint(e.clientX, e.clientY);
    addNode(type, Math.max(20, pt.x - 100), Math.max(20, pt.y - 39));
  };

  const nodeMap = useMemo(() => {
    const map = new Map<string, CanvasNodeDraft>();
    for (const n of nodes) map.set(n.clientId, n);
    return map;
  }, [nodes]);

  return (
    <div className="studio-container">
      {/* Studio Workspace Toolbar */}
      <div className="workspace-toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={handleNew} title="Create a new script or blueprint">
            New
          </button>
          <button type="button" onClick={handleSave} disabled={saving} title="Save to backend server">
            {saving ? 'Saving...' : workflowId ? `Save (#${workflowId})` : 'Save'}
          </button>

          <div className="toolbar-divider" />

          <input
            aria-label="Script or workflow name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Workflow / script name"
            style={{ width: '200px', fontWeight: 600 }}
          />

          <div className="segmented-control" role="group" aria-label="Editor mode">
            <button
              type="button"
              className={mode === 'blueprint' ? 'active' : ''}
              onClick={() => handleSwitchMode('blueprint')}
            >
              Blueprint (n8n)
            </button>
            <button
              type="button"
              className={mode === 'code' ? 'active' : ''}
              onClick={() => handleSwitchMode('code')}
            >
              Lua Code
            </button>
          </div>
        </div>

        <div className="toolbar-group">
          <select
            aria-label="Trigger type"
            value={triggerType}
            onChange={e => setTriggerType(e.target.value as TriggerMode)}
          >
            <option value="manual">Trigger: Manual</option>
            <option value="schedule">Trigger: Schedule</option>
            <option value="webhook">Trigger: Webhook</option>
          </select>

          {triggerType === 'schedule' && (
            <input
              type="number"
              min={5}
              max={86400}
              aria-label="Schedule interval in seconds"
              value={scheduleSeconds}
              onChange={e => setScheduleSeconds(Math.max(5, Number(e.target.value) || 60))}
              style={{ width: '74px' }}
              className="tabular-nums"
              title="Run interval in seconds (min 5s)"
            />
          )}

          <button
            type="button"
            onClick={() => setIsActive(a => !a)}
            title="Toggle workflow active status for schedules and webhooks"
          >
            <span className={`status-text ${isActive ? 'completed' : 'idle'}`}>
              {isActive ? 'Active' : 'Paused'}
            </span>
          </button>

          <div className="toolbar-divider" />

          {mode === 'blueprint' && (
            <>
              <button
                type="button"
                onClick={() =>
                  addNode(
                    selectedPaletteType,
                    180 + (nodes.length % 5) * 45,
                    120 + (nodes.length % 4) * 50
                  )
                }
              >
                + Add Node
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={!selectedNode && !selectedEdgeId}
              >
                Delete
              </button>
              <div className="toolbar-divider" />
            </>
          )}

          <button
            type="button"
            className="btn-accent"
            onClick={handleExecute}
            disabled={saving || activeExecutionId !== null}
            title="Save and execute immediately on Poseidon server"
          >
            Save & Run
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleStop}
            disabled={activeExecutionId === null}
            title="Abort active server execution"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      {mode === 'blueprint' ? (
        <div className="studio-workspace">
          {/* Left Palette */}
          <aside className="palette-sidebar">
            <div className="pane-header">
              <span>Node Palette</span>
              <span className="tabular-nums">{NODE_PALETTE.length}</span>
            </div>
            <div className="palette-list">
              {NODE_PALETTE.map(item => (
                <div
                  key={item.type}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('application/poseidon-node', item.type);
                    setSelectedPaletteType(item.type);
                  }}
                  onClick={() => setSelectedPaletteType(item.type)}
                  onDoubleClick={() =>
                    addNode(item.type, 180 + nodes.length * 32, 120 + nodes.length * 26)
                  }
                  className={`palette-item ${selectedPaletteType === item.type ? 'selected' : ''}`}
                  title="Drag onto canvas or double-click to add"
                >
                  <span>{item.label}</span>
                  <span className="palette-category">{item.category}</span>
                </div>
              ))}
            </div>
          </aside>

          {/* Center Blueprint Canvas */}
          <div
            ref={canvasRef}
            className="canvas-pane"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onDragOver={e => e.preventDefault()}
            onDrop={handleCanvasDrop}
          >
            {/* Zoom & Auto-Layout Controls */}
            <div className="canvas-controls">
              <button
                type="button"
                className={zoom === 0.75 ? 'btn-accent' : ''}
                onClick={() => setZoom(0.75)}
              >
                75%
              </button>
              <button
                type="button"
                className={zoom === 1 ? 'btn-accent' : ''}
                onClick={() => setZoom(1)}
              >
                100%
              </button>
              <button
                type="button"
                className={zoom === 1.25 ? 'btn-accent' : ''}
                onClick={() => setZoom(1.25)}
              >
                125%
              </button>
              <button
                type="button"
                onClick={() => {
                  setPan({ x: 0, y: 0 });
                  setZoom(1);
                }}
              >
                Reset
              </button>
              <button type="button" onClick={handleAutoLayout} title="Arrange DAG left-to-right">
                Auto-Layout
              </button>
            </div>

            {/* Transformed Layer */}
            <div
              data-canvas-bg="true"
              style={{
                position: 'absolute',
                inset: 0,
                transformOrigin: '0 0',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
              }}
            >
              {/* SVG Edges */}
              <svg
                data-canvas-bg="true"
                style={{
                  position: 'absolute',
                  left: -2000,
                  top: -2000,
                  width: 6000,
                  height: 6000,
                  overflow: 'visible',
                  pointerEvents: 'none'
                }}
              >
                <defs>
                  <marker
                    id="arrow-default"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#708096" />
                  </marker>
                  <marker
                    id="arrow-success"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#22c55e" />
                  </marker>
                  <marker
                    id="arrow-error"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
                  </marker>
                </defs>

                {edges.map(edge => {
                  const src = nodeMap.get(edge.sourceClientId);
                  const tgt = nodeMap.get(edge.targetClientId);
                  if (!src || !tgt) return null;
                  const x1 = src.x + 200 + 2000;
                  const y1 = src.y + 39 + 2000;
                  const x2 = tgt.x + 2000;
                  const y2 = tgt.y + 39 + 2000;
                  const dx = Math.max(44, Math.abs(x2 - x1) * 0.45);
                  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                  const isSelected = edge.id === selectedEdgeId;
                  const stroke = isSelected
                    ? '#2563eb'
                    : edge.condition === 'on_success'
                      ? '#22c55e'
                      : edge.condition === 'on_error'
                        ? '#ef4444'
                        : '#708096';
                  const marker =
                    edge.condition === 'on_success'
                      ? 'url(#arrow-success)'
                      : edge.condition === 'on_error'
                        ? 'url(#arrow-error)'
                        : 'url(#arrow-default)';

                  return (
                    <path
                      key={edge.id}
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isSelected ? 3 : 2}
                      markerEnd={marker}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onMouseDown={ev => {
                        ev.stopPropagation();
                        setSelectedEdgeId(edge.id);
                        setSelectedNodeId(null);
                      }}
                    />
                  );
                })}

                {connectingFrom &&
                  (() => {
                    const src = nodeMap.get(connectingFrom.sourceClientId);
                    if (!src) return null;
                    const x1 = src.x + 200 + 2000;
                    const y1 = src.y + 39 + 2000;
                    const x2 = connectingFrom.mouseX + 2000;
                    const y2 = connectingFrom.mouseY + 2000;
                    return (
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#60a5fa"
                        strokeWidth={2}
                        strokeDasharray="5,3"
                      />
                    );
                  })()}
              </svg>

              {/* Node Cards */}
              {nodes.map(node => {
                const status = nodeStatuses[node.clientId];
                const isSelected = selectedNode?.clientId === node.clientId;
                return (
                  <div
                    key={node.clientId}
                    className={`node-card ${isSelected ? 'selected' : ''} ${status ? `status-${status}` : ''}`}
                    style={{ left: node.x, top: node.y }}
                    onMouseDown={e => {
                      e.stopPropagation();
                      setSelectedNodeId(node.clientId);
                      setSelectedEdgeId(null);
                      const pt = getCanvasPoint(e.clientX, e.clientY);
                      setDraggingNode({
                        clientId: node.clientId,
                        offsetX: pt.x - node.x,
                        offsetY: pt.y - node.y
                      });
                    }}
                  >
                    <div
                      className="connector input"
                      title="Input port (drop connection here)"
                      onMouseUp={e => handleNodePortMouseUp(node.clientId, e)}
                    />
                    <div
                      className="connector output"
                      title="Output port (drag to another node)"
                      onMouseDown={e => {
                        e.stopPropagation();
                        const pt = getCanvasPoint(e.clientX, e.clientY);
                        setConnectingFrom({
                          sourceClientId: node.clientId,
                          mouseX: pt.x,
                          mouseY: pt.y
                        });
                      }}
                    />
                    <div className="node-titlebar">
                      <span className="node-title">{node.name}</span>
                      <span className="node-kind">{node.type}</span>
                    </div>
                    <div className="node-preview mono">
                      {status ? `${status} · ` : ''}
                      {node.script.replace(/\s+/g, ' ').slice(0, 32)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="canvas-hint">
              Drag nodes from palette · Drag blue output dot to input dot to connect · Drag background to pan
            </div>
          </div>

          {/* Right Properties & Lua Script Editor */}
          <aside className="inspector-sidebar">
            <div className="pane-header">
              <span>Inspector</span>
              {triggerType === 'webhook' && (
                <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {workflowId ? `/api/webhooks/${workflowId}` : 'Save for webhook URL'}
                </span>
              )}
            </div>
            <div className="properties-box">
              {selectedEdge ? (
                <>
                  <div className="prop-row">
                    <label>Edge</label>
                    <input
                      readOnly
                      value={`${nodeMap.get(selectedEdge.sourceClientId)?.name ?? ''} -> ${nodeMap.get(selectedEdge.targetClientId)?.name ?? ''}`}
                    />
                  </div>
                  <div className="prop-row">
                    <label>Condition</label>
                    <select
                      value={selectedEdge.condition}
                      onChange={e => {
                        const cond = e.target.value as EdgeCondition;
                        setEdges(prev =>
                          prev.map(ed => (ed.id === selectedEdge.id ? { ...ed, condition: cond } : ed))
                        );
                      }}
                    >
                      <option value="on_success">on_success</option>
                      <option value="on_error">on_error</option>
                      <option value="always">always</option>
                    </select>
                  </div>
                  <button type="button" className="btn-danger" onClick={handleDeleteSelected}>
                    Delete Edge
                  </button>
                </>
              ) : selectedNode ? (
                <>
                  <div className="prop-row">
                    <label>Node ID</label>
                    <input readOnly value={selectedNode.clientId} className="mono" />
                  </div>
                  <div className="prop-row">
                    <label>Type</label>
                    <input readOnly value={selectedNode.type} className="mono" />
                  </div>
                  <div className="prop-row">
                    <label>Name</label>
                    <input
                      value={selectedNode.name}
                      onChange={e => updateSelectedNode({ name: e.target.value })}
                    />
                  </div>
                  <div className="prop-row">
                    <label>Position</label>
                    <input
                      type="number"
                      className="tabular-nums"
                      value={selectedNode.x}
                      onChange={e => updateSelectedNode({ x: Number(e.target.value) || 0 })}
                    />
                    <input
                      type="number"
                      className="tabular-nums"
                      value={selectedNode.y}
                      onChange={e => updateSelectedNode({ y: Number(e.target.value) || 0 })}
                    />
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  Select a node or edge on the canvas.
                </div>
              )}

              <div className="prop-row">
                <label>Input JSON</label>
                <input
                  className="mono"
                  value={inputJsonText}
                  onChange={e => setInputJsonText(e.target.value)}
                  placeholder='{"url":"..."}'
                />
              </div>
            </div>

            <div className="pane-header">
              <span>Lua Script</span>
              {templates.length > 0 && selectedNode && (
                <select
                  aria-label="Load Lua example"
                  defaultValue=""
                  onChange={e => {
                    const tpl = templates.find(t => String(t.id) === e.target.value);
                    if (tpl) updateSelectedNode({ script: tpl.content });
                    e.target.value = '';
                  }}
                  style={{ fontSize: '11.5px', padding: '3px 6px' }}
                >
                  <option value="" disabled>
                    Load example...
                  </option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="lua-editor-wrap">
              <div className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                API: http · db · json · fs · crypto · flow · mail · ai
              </div>
              <textarea
                className="lua-textarea"
                spellCheck={false}
                value={selectedNode?.script ?? ''}
                onChange={e => updateSelectedNode({ script: e.target.value })}
                placeholder="return { run = function(context) ... end }"
              />
            </div>
          </aside>
        </div>
      ) : (
        /* Standalone Lua Code Mode */
        <div className="studio-workspace">
          <div className="code-mode-pane">
            <div className="code-mode-bar">
              <div className="toolbar-group" style={{ flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '12.5px', color: '#ffffff' }}>
                  Lua Script Editor
                </span>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  http · db · json · fs · crypto · flow · mail · ai
                </span>
                <input
                  placeholder="Optional description..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  style={{ width: '240px' }}
                />
                {templates.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={e => {
                      const tpl = templates.find(t => String(t.id) === e.target.value);
                      if (tpl && selectedNode) {
                        updateSelectedNode({ script: tpl.content });
                      }
                      e.target.value = '';
                    }}
                  >
                    <option value="" disabled>
                      Insert example template...
                    </option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="toolbar-group">
                {triggerType === 'webhook' && (
                  <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    {workflowId ? `POST /api/webhooks/${workflowId}` : 'Save to get webhook URL'}
                  </span>
                )}
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Input JSON</span>
                <input
                  className="mono"
                  value={inputJsonText}
                  onChange={e => setInputJsonText(e.target.value)}
                  style={{ width: '220px' }}
                />
              </div>
            </div>
            <div className="lua-editor-wrap">
              <textarea
                className="lua-textarea"
                spellCheck={false}
                value={selectedNode?.script ?? ''}
                onChange={e => updateSelectedNode({ script: e.target.value })}
                placeholder={`-- Globals: http, db, json, fs, crypto, flow, mail, ai\nreturn {\n  run = function(context)\n    flow.log("hello world!")\n    return { ok = true }\n  end\n}`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bottom Execution Log */}
      <div className="log-panel">
        <div className="pane-header">
          <span>Execution Log</span>
          <button type="button" onClick={onClearLogs} style={{ padding: '3px 9px', fontSize: '11.5px' }}>
            Clear
          </button>
        </div>
        <div className="log-list">
          {logs.map(entry => (
            <div key={entry.id} className={`log-row ${entry.level}`}>
              [{entry.timestamp}] {entry.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
