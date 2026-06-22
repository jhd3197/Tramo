/**
 * Human-in-the-loop suspension.
 *
 * An executor throws `ApprovalRequiredError` to pause the whole run. The
 * scheduler catches it, persists a checkpoint, and returns a `suspended`
 * RunResult listing the pending requests. The host (or `@tramo/server`)
 * collects a decision and resumes with `resumeFrom` + `approvals`.
 *
 * The built-in `approval-gate` node throws this, but any custom node can too
 * — it's the generic "wait for an external signal" primitive.
 */

import type { ApprovalRequest } from './types.js';

export class ApprovalRequiredError extends Error {
  readonly request: ApprovalRequest;
  constructor(request: ApprovalRequest) {
    super(request.message ?? `approval required for ${request.nodeId}`);
    this.name = 'ApprovalRequiredError';
    this.request = request;
  }
}

export function isApprovalRequired(err: unknown): err is ApprovalRequiredError {
  return err instanceof ApprovalRequiredError ||
    (typeof err === 'object' && err != null && (err as { name?: string }).name === 'ApprovalRequiredError');
}
