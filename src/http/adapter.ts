import {
  type Actor,
  type ApprovalRequest,
  type ApprovalRequestInput,
  approveRequest,
  createApprovalRequest,
  isApiError,
  rejectRequest,
} from "../domain/approval-workflow.js";
import {
  type ApprovalRequestRepository,
  InMemoryApprovalRequestRepository,
} from "./repository.js";

export interface HttpRequest {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ApprovalWorkflowHandlerOptions {
  repository?: ApprovalRequestRepository;
  now?: () => Date;
  idGenerator?: () => string;
}

export function createApprovalWorkflowHandler(options: ApprovalWorkflowHandlerOptions = {}) {
  const repository = options.repository ?? new InMemoryApprovalRequestRepository();

  return async function handle(request: HttpRequest): Promise<HttpResponse> {
    if (request.method === "POST" && request.path === "/approval-requests") {
      const result = createApprovalRequest(request.body as ApprovalRequestInput, {
        now: options.now,
        id: options.idGenerator?.(),
      });

      if (!isApiError(result.body)) {
        await repository.save(result.body);
      }

      return json(result.status, result.body);
    }

    const approveMatch = request.path.match(/^\/approval-requests\/([^/]+)\/approve$/);

    if (request.method === "POST" && approveMatch) {
      return runDecisionRoute(approveMatch[1], request, repository, (stored, actor) =>
        approveRequest(stored, actor, { now: options.now }),
      );
    }

    const rejectMatch = request.path.match(/^\/approval-requests\/([^/]+)\/reject$/);

    if (request.method === "POST" && rejectMatch) {
      const reason = parseReason(request.body);

      return runDecisionRoute(rejectMatch[1], request, repository, (stored, actor) =>
        rejectRequest(stored, actor, reason, { now: options.now }),
      );
    }

    return json(404, {
      error: {
        code: "route_not_found",
        message: "No approval workflow route matched the request.",
      },
    });
  };
}

async function runDecisionRoute(
  requestId: string,
  request: HttpRequest,
  repository: ApprovalRequestRepository,
  operation: (stored: ApprovalRequest, actor: Actor) => ReturnType<typeof approveRequest>,
): Promise<HttpResponse> {
  const actor = parseActor(request.headers);

  if (!actor) {
    return json(401, {
      error: {
        code: "actor_required",
        message: "Decision routes require x-user-id and x-user-role headers.",
      },
    });
  }

  const stored = await repository.get(requestId);

  if (!stored) {
    return json(404, {
      error: {
        code: "request_not_found",
        message: "No approval request exists for the supplied id.",
      },
    });
  }

  const result = operation(stored, actor);

  if (!isApiError(result.body)) {
    await repository.save(result.body);
  }

  return json(result.status, result.body);
}

function parseActor(headers: HttpRequest["headers"]): Actor | null {
  const userId = readHeader(headers, "x-user-id");
  const role = readHeader(headers, "x-user-role");

  if (!userId || !isApprovalRole(role)) {
    return null;
  }

  return {
    userId,
    role,
  };
}

function readHeader(headers: HttpRequest["headers"], name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function isApprovalRole(role: string | undefined): role is Actor["role"] {
  return role === "requester" || role === "manager" || role === "finance";
}

function parseReason(body: unknown): string {
  if (!body || typeof body !== "object" || !("reason" in body)) {
    return "";
  }

  const reason = (body as { reason: unknown }).reason;
  return typeof reason === "string" ? reason : "";
}

function json(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body,
  };
}
