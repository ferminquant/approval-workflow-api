import { randomUUID } from "node:crypto";

export type ApprovalState = "pending" | "approved" | "rejected";
export type ApprovalRole = "requester" | "manager" | "finance";
export type ApproverRole = Exclude<ApprovalRole, "requester">;

export type AuditAction = "submitted" | "approved" | "rejected";

export interface ApprovalRequestInput {
  title: string;
  amount: number;
  requesterId: string;
  costCenter: string;
  justification: string;
}

export interface Actor {
  userId: string;
  role: ApprovalRole;
}

export interface AuditEvent {
  actorId: string;
  action: AuditAction;
  at: string;
  note?: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  amount: number;
  requesterId: string;
  costCenter: string;
  justification: string;
  requiredApprovalRole: ApproverRole;
  state: ApprovalState;
  createdAt: string;
  updatedAt: string;
  version: number;
  audit: AuditEvent[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    nextAction?: string;
  };
}

export interface ApiResult<T> {
  status: number;
  body: T | ApiErrorBody;
}

interface OperationOptions {
  now?: () => Date;
}

interface CreateOptions extends OperationOptions {
  id?: string;
}

// snippet:create-request-start
export function createApprovalRequest(
  input: ApprovalRequestInput,
  options: CreateOptions = {},
): ApiResult<ApprovalRequest> {
  const validation = validateInput(input);

  if (validation) {
    return failure(422, "validation_failed", validation.message, {
      field: validation.field,
    });
  }

  const at = timestamp(options);
  const request: ApprovalRequest = {
    id: options.id ?? randomUUID(),
    title: input.title,
    amount: input.amount,
    requesterId: input.requesterId,
    costCenter: input.costCenter,
    justification: input.justification,
    requiredApprovalRole: input.amount > 2500 ? "finance" : "manager",
    state: "pending",
    createdAt: at,
    updatedAt: at,
    version: 1,
    audit: [
      {
        actorId: input.requesterId,
        action: "submitted",
        at,
      },
    ],
  };

  return {
    status: 201,
    body: request,
  };
}
// snippet:create-request-end

// snippet:approve-request-start
export function approveRequest(
  request: ApprovalRequest,
  actor: Actor,
  options: OperationOptions = {},
): ApiResult<ApprovalRequest> {
  if (actor.role === "requester") {
    return failure(403, "approval_role_required", "Only manager or finance roles can approve requests.");
  }

  if (request.state !== "pending") {
    return failure(409, "request_not_pending", "Only pending requests can be approved.", {
      currentState: request.state,
    });
  }

  if (actor.userId === request.requesterId) {
    return failure(
      409,
      "separation_of_duties_required",
      "A requester cannot approve their own request.",
    );
  }

  if (request.requiredApprovalRole === "finance" && actor.role !== "finance") {
    return failure(
      422,
      "finance_review_required",
      "This request exceeds the manager approval limit.",
      { requiredApprovalRole: request.requiredApprovalRole },
      "Route to a finance approver.",
    );
  }

  const at = timestamp(options);

  return {
    status: 200,
    body: {
      ...request,
      state: "approved",
      updatedAt: at,
      version: request.version + 1,
      audit: [
        ...request.audit,
        {
          actorId: actor.userId,
          action: "approved",
          at,
        },
      ],
    },
  };
}
// snippet:approve-request-end

export function rejectRequest(
  request: ApprovalRequest,
  actor: Actor,
  reason: string,
  options: OperationOptions = {},
): ApiResult<ApprovalRequest> {
  if (actor.role === "requester") {
    return failure(403, "approval_role_required", "Only manager or finance roles can reject requests.");
  }

  if (request.state !== "pending") {
    return failure(409, "request_not_pending", "Only pending requests can be rejected.", {
      currentState: request.state,
    });
  }

  if (!reason || reason.trim().length < 12) {
    return failure(422, "validation_failed", "A rejection reason must be specific enough to act on.", {
      field: "reason",
    });
  }

  const at = timestamp(options);

  return {
    status: 200,
    body: {
      ...request,
      state: "rejected",
      updatedAt: at,
      version: request.version + 1,
      audit: [
        ...request.audit,
        {
          actorId: actor.userId,
          action: "rejected",
          at,
          note: reason.trim(),
        },
      ],
    },
  };
}

export function isApiError(body: unknown): body is ApiErrorBody {
  return Boolean(body && typeof body === "object" && "error" in body);
}

function validateInput(input: ApprovalRequestInput): { field: string; message: string } | null {
  if (!input || typeof input !== "object") {
    return { field: "body", message: "A JSON request body is required." };
  }

  if (!input.title || input.title.trim().length < 8) {
    return { field: "title", message: "A title of at least 8 characters is required." };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { field: "amount", message: "Amount must be greater than zero." };
  }

  if (!input.requesterId || input.requesterId.trim().length < 3) {
    return { field: "requesterId", message: "Requester identity is required." };
  }

  if (!/^CC-\d{4}$/.test(input.costCenter)) {
    return { field: "costCenter", message: "Cost center must match CC-0000 format." };
  }

  if (!input.justification || input.justification.trim().length < 20) {
    return {
      field: "justification",
      message: "Justification must explain the business need.",
    };
  }

  return null;
}

function failure(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  nextAction?: string,
): ApiResult<never> {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        ...(nextAction ? { nextAction } : {}),
      },
    },
  };
}

function timestamp(options: OperationOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}
