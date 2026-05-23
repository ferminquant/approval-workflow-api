# Approval Workflow API

A focused REST API example for approval workflow rules, explicit failures, and auditable state transitions.

This repository backs the Backend APIs case study at [ferminquant.com](https://ferminquant.com/examples/backend-apis/approval-workflow/). It is intentionally small: the point is to show API design judgment, not to hide the signal inside a large service.

The implementation has two paths:

- **C#/.NET**: domain rules plus a Minimal API boundary for an enterprise backend stack.
- **TypeScript/Node.js**: the same workflow rules and REST boundary for a Node.js service stack.

## What It Demonstrates

- REST endpoints with stable request and response shapes.
- Domain logic kept separate from the HTTP adapter.
- Business-rule failures that are explicit and actionable.
- Caller-role checks at decision boundaries.
- Audit history attached to every state transition.
- Tests that cover normal, invalid, unauthorized, and business-rule paths.

## Commands

```bash
npm install
npm test
npm run build
npm run openapi:check
npm start
```

The local server listens on `http://localhost:3000`.

The C#/.NET path uses .NET 8:

```bash
npm run dotnet:build
npm run dotnet:test
dotnet run --project csharp/ApprovalWorkflow.Api/ApprovalWorkflow.Api.csproj
```

## Architecture

```txt
HTTP server or Minimal API
  -> REST adapter/endpoints
    -> approval workflow domain functions
    -> approval request repository
```

The domain functions are pure enough to test directly. The HTTP adapter proves the same behavior through a REST-shaped boundary without requiring a deployed service.

## Endpoint Surface

| Method | Path | Success | Main failures |
| --- | --- | --- | --- |
| `POST` | `/approval-requests` | `201` pending request | `422 validation_failed` |
| `POST` | `/approval-requests/{id}/approve` | `200` approved request | `401 actor_required`, `403 approval_role_required`, `404 request_not_found`, `409 request_not_pending`, `422 finance_review_required` |
| `POST` | `/approval-requests/{id}/reject` | `200` rejected request | `401 actor_required`, `403 approval_role_required`, `404 request_not_found`, `409 request_not_pending`, `422 validation_failed` |

The OpenAPI contract lives in [`src/openapi/approval-workflow.openapi.json`](src/openapi/approval-workflow.openapi.json).

## Test Matrix

| Scenario | Behavior | Test file |
| --- | --- | --- |
| Standard request approval | `201` create, then `200` approve with audit trail | [`test/domain.test.ts`](test/domain.test.ts), [`test/http-adapter.test.ts`](test/http-adapter.test.ts), [`csharp/ApprovalWorkflow.Tests/ApprovalWorkflowEngineTests.cs`](csharp/ApprovalWorkflow.Tests/ApprovalWorkflowEngineTests.cs), [`csharp/ApprovalWorkflow.Api.Tests/ApprovalWorkflowApiTests.cs`](csharp/ApprovalWorkflow.Api.Tests/ApprovalWorkflowApiTests.cs) |
| Finance approval required | Manager receives `422 finance_review_required` with next action | [`test/domain.test.ts`](test/domain.test.ts), [`test/http-adapter.test.ts`](test/http-adapter.test.ts), [`csharp/ApprovalWorkflow.Tests/ApprovalWorkflowEngineTests.cs`](csharp/ApprovalWorkflow.Tests/ApprovalWorkflowEngineTests.cs), [`csharp/ApprovalWorkflow.Api.Tests/ApprovalWorkflowApiTests.cs`](csharp/ApprovalWorkflow.Api.Tests/ApprovalWorkflowApiTests.cs) |
| Caller has no approval role | Requester receives `403 approval_role_required` | [`test/domain.test.ts`](test/domain.test.ts), [`csharp/ApprovalWorkflow.Tests/ApprovalWorkflowEngineTests.cs`](csharp/ApprovalWorkflow.Tests/ApprovalWorkflowEngineTests.cs) |
| Missing actor headers | Decision route returns `401 actor_required` | [`test/http-adapter.test.ts`](test/http-adapter.test.ts) |
| Unknown request id | Decision route returns `404 request_not_found` | [`test/http-adapter.test.ts`](test/http-adapter.test.ts) |
| Rejection path | `200` rejected request with audit note | [`test/domain.test.ts`](test/domain.test.ts), [`test/http-adapter.test.ts`](test/http-adapter.test.ts) |

## Production Hardening Path

This example keeps durable infrastructure out of scope so the behavior is easy to evaluate locally. In production, the next changes would be:

- Replace header-based identity with verified claims from an identity provider.
- Add idempotency keys for create and decision routes.
- Store requests in a durable database with optimistic concurrency.
- Emit structured logs, traces, metrics, and correlation ids.
- Apply retention rules to audit events.
- Add contract tests against the deployed HTTP entry point.
