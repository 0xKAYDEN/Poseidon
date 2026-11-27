import { runLuaScript } from './luaEngine.js';
import type { PoseidonStore, WorkflowEdge, WorkflowNode } from './store.js';

export interface StepEvent {
  execution_id: number;
  workflow_id: number;
  node_id: number;
  client_id: string;
  node_name: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  output?: string | null;
  error?: string | null;
  duration_ms?: number | null;
}

export interface ExecutionCallbacks {
  onStep?: (event: StepEvent) => void;
  onLog?: (executionId: number, workflowId: number, nodeId: number, message: string) => void;
  onEvent?: (executionId: number, workflowId: number, nodeId: number, eventName: string, payload: unknown) => void;
  onComplete?: (executionId: number, workflowId: number, status: string, outputJson: string | null, error: string | null) => void;
}

export class WorkflowEngine {
  private readonly activeAbortControllers = new Map<number, AbortController>();

  constructor(private readonly store: PoseidonStore) {}

  stopExecution(executionId: number): boolean {
    const controller = this.activeAbortControllers.get(executionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  stopWorkflowExecutions(workflowId: number): number {
    let stopped = 0;
    const executions = this.store.getExecutions(workflowId);
    for (const ex of executions) {
      if (ex.status === 'running' || ex.status === 'queued') {
        if (this.stopExecution(ex.id)) {
          stopped++;
        } else {
          this.store.updateExecutionStatus(ex.id, 'cancelled', null, 'Stopped by user');
          stopped++;
        }
      }
    }
    return stopped;
  }

  isExecutionActive(executionId: number): boolean {
    return this.activeAbortControllers.has(executionId);
  }

  hasActiveWorkflowExecution(workflowId: number): boolean {
    const executions = this.store.getExecutions(workflowId);
    for (const ex of executions) {
      if ((ex.status === 'running' || ex.status === 'queued') && this.activeAbortControllers.has(ex.id)) {
        return true;
      }
    }
    return false;
  }

  async executeAsync(
    workflowId: number,
    executionId: number,
    initialInput: Record<string, unknown> = {},
    callbacks: ExecutionCallbacks = {}
  ): Promise<void> {
    const controller = new AbortController();
    this.activeAbortControllers.set(executionId, controller);

    try {
      this.store.markExecutionRunning(executionId);

      const nodes = this.store.getNodes(workflowId);
      const edges = this.store.getEdges(workflowId);

      if (nodes.length === 0) {
        this.store.updateExecutionStatus(executionId, 'completed', null, 'no nodes');
        callbacks.onComplete?.(executionId, workflowId, 'completed', null, 'no nodes');
        return;
      }

      const predecessors = new Map<number, WorkflowEdge[]>();
      const successors = new Map<number, WorkflowEdge[]>();
      for (const edge of edges) {
        const p = predecessors.get(edge.target_node_id) ?? [];
        p.push(edge);
        predecessors.set(edge.target_node_id, p);

        const s = successors.get(edge.source_node_id) ?? [];
        s.push(edge);
        successors.set(edge.source_node_id, s);
      }

      const pendingPred = new Map<number, number>();
      const nodeById = new Map<number, WorkflowNode>();
      for (const node of nodes) {
        nodeById.set(node.id, node);
        pendingPred.set(node.id, predecessors.get(node.id)?.length ?? 0);
      }

      const queue: WorkflowNode[] = nodes.filter(n => (pendingPred.get(n.id) ?? 0) === 0);
      if (queue.length === 0) {
        this.store.updateExecutionStatus(executionId, 'failed', null, 'Cycle detected in workflow graph');
        callbacks.onComplete?.(executionId, workflowId, 'failed', null, 'Cycle detected in workflow graph');
        return;
      }

      const outputs = new Map<number, Record<string, unknown>>();
      const failedNodes = new Set<number>();
      const skippedNodes = new Set<number>();
      const sharedState = new Map<string, unknown>();
      const secrets = this.store.getDecryptedSecretsMap();

      const enqueueSuccessors = (n: WorkflowNode) => {
        const sucs = successors.get(n.id) ?? [];
        for (const succ of sucs) {
          const nextCount = (pendingPred.get(succ.target_node_id) ?? 0) - 1;
          pendingPred.set(succ.target_node_id, nextCount);
          if (
            nextCount === 0 &&
            !skippedNodes.has(succ.target_node_id) &&
            !failedNodes.has(succ.target_node_id)
          ) {
            const targetNode = nodeById.get(succ.target_node_id);
            if (targetNode) queue.push(targetNode);
          }
        }
      };

      while (queue.length > 0 && !controller.signal.aborted) {
        const node = queue.shift()!;
        const preds = predecessors.get(node.id) ?? [];

        const inputs: Record<string, unknown> = { ...initialInput };
        for (const edge of preds) {
          const predOut = outputs.get(edge.source_node_id);
          if (predOut !== undefined) {
            inputs[String(edge.source_node_id)] = predOut;
            inputs['prev'] = predOut;
          }
        }

        // Handle conditional routing (on_success / on_error / always)
        if (preds.length > 0) {
          const shouldSkip = preds.every(edge => {
            const predFailed = failedNodes.has(edge.source_node_id);
            const predSkipped = skippedNodes.has(edge.source_node_id);
            if (predSkipped) return true;
            if (edge.condition_type === 'on_error') return !predFailed;
            if (edge.condition_type === 'on_success') return predFailed;
            // 'always' runs regardless unless predecessor was skipped
            return false;
          });

          if (shouldSkip) {
            skippedNodes.add(node.id);
            const skipStep = this.store.createStep(executionId, node.id, node.name, null);
            this.store.completeStep(skipStep.id, 'skipped', null, null, 0);
            callbacks.onStep?.({
              execution_id: executionId,
              workflow_id: workflowId,
              node_id: node.id,
              client_id: node.client_id,
              node_name: node.name,
              status: 'skipped',
              duration_ms: 0
            });
            enqueueSuccessors(node);
            continue;
          }
        }

        const inputStr = JSON.stringify(inputs);
        const step = this.store.createStep(executionId, node.id, node.name, inputStr);
        callbacks.onStep?.({
          execution_id: executionId,
          workflow_id: workflowId,
          node_id: node.id,
          client_id: node.client_id,
          node_name: node.name,
          status: 'running'
        });

        const stepStart = Date.now();
        if (!node.script.trim()) {
          const err = `Node "${node.name}" has no Lua script`;
          const dur = Date.now() - stepStart;
          this.store.completeStep(step.id, 'failed', null, err, dur);
          failedNodes.add(node.id);
          callbacks.onStep?.({
            execution_id: executionId,
            workflow_id: workflowId,
            node_id: node.id,
            client_id: node.client_id,
            node_name: node.name,
            status: 'failed',
            error: err,
            duration_ms: dur
          });
          enqueueSuccessors(node);
          continue;
        }

        try {
          const context = {
            inputs,
            node: {
              id: node.id,
              client_id: node.client_id,
              name: node.name,
              type: node.type
            },
            secrets
          };

          const result = await runLuaScript(node.script, context, {
            store: this.store,
            sharedState,
            timeoutMs: 30_000,
            signal: controller.signal,
            log: msg => {
              callbacks.onLog?.(executionId, workflowId, node.id, `[${node.name}] ${msg}`);
            },
            emitEvent: (eventName, payload) => {
              callbacks.onEvent?.(executionId, workflowId, node.id, eventName, payload);
            }
          });

          const dur = Date.now() - stepStart;
          const outJson = JSON.stringify(result);
          this.store.completeStep(step.id, 'completed', outJson, null, dur);
          outputs.set(node.id, result);
          callbacks.onStep?.({
            execution_id: executionId,
            workflow_id: workflowId,
            node_id: node.id,
            client_id: node.client_id,
            node_name: node.name,
            status: 'completed',
            output: outJson,
            duration_ms: dur
          });
        } catch (err) {
          const dur = Date.now() - stepStart;
          const errMsg = (err as Error).message || 'Node execution failed';
          this.store.completeStep(step.id, 'failed', null, errMsg, dur);
          failedNodes.add(node.id);
          callbacks.onStep?.({
            execution_id: executionId,
            workflow_id: workflowId,
            node_id: node.id,
            client_id: node.client_id,
            node_name: node.name,
            status: 'failed',
            error: errMsg,
            duration_ms: dur
          });
        }

        enqueueSuccessors(node);
      }

      const finalOutputObj: Record<string, unknown> = {};
      for (const [nid, out] of outputs.entries()) {
        finalOutputObj[String(nid)] = out;
      }
      const finalOutputJson = JSON.stringify(finalOutputObj);

      const finalStatus = controller.signal.aborted
        ? 'cancelled'
        : failedNodes.size > 0
          ? 'failed'
          : 'completed';
      const finalError = controller.signal.aborted
        ? 'Execution stopped by user'
        : failedNodes.size > 0
          ? 'One or more nodes failed'
          : null;

      this.store.updateExecutionStatus(executionId, finalStatus, finalOutputJson, finalError);
      callbacks.onComplete?.(executionId, workflowId, finalStatus, finalOutputJson, finalError);
    } finally {
      this.activeAbortControllers.delete(executionId);
    }
  }
}
