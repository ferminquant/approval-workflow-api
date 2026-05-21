import { describe, expect, it } from "vitest";
import {
  type HttpRequest,
  createApprovalWorkflowHandler,
} from "../src/http/adapter.js";

const fixedNow = () => new Date("2026-01-15T10:30:00.000Z");

describe("approval workflow HTTP adapter", () => {
  it("runs the create and approve path through the REST boundary", async () => {
    const handle = createApprovalWorkflowHandler({
      now: fixedNow,
      idGenerator: () => "apr-http-standard",
    });

    const created = await handle(createRequest());

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "apr-http-standard",
      state: "pending",
    });

    const approved = await handle({
      method: "POST",
      path: "/approval-requests/apr-http-standard/approve",
      headers: {
        "x-user-id": "manager-1",
        "x-user-role": "manager",
      },
    });

    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      id: "apr-http-standard",
      state: "approved",
      audit: [
        { actorId: "user-1", action: "submitted" },
        { actorId: "manager-1", action: "approved" },
      ],
    });
  });

  it("returns a business-rule response when finance approval is required", async () => {
    const handle = createApprovalWorkflowHandler({
      now: fixedNow,
      idGenerator: () => "apr-http-finance",
    });

    await handle(createRequest({ amount: 7200 }));

    const approved = await handle({
      method: "POST",
      path: "/approval-requests/apr-http-finance/approve",
      headers: {
        "x-user-id": "manager-1",
        "x-user-role": "manager",
      },
    });

    expect(approved.status).toBe(422);
    expect(approved.body).toMatchObject({
      error: {
        code: "finance_review_required",
        nextAction: "Route to a finance approver.",
      },
    });
  });

  it("requires caller identity on decision routes", async () => {
    const handle = createApprovalWorkflowHandler({
      now: fixedNow,
      idGenerator: () => "apr-http-actor",
    });

    await handle(createRequest());

    const approved = await handle({
      method: "POST",
      path: "/approval-requests/apr-http-actor/approve",
    });

    expect(approved.status).toBe(401);
    expect(approved.body).toMatchObject({
      error: {
        code: "actor_required",
      },
    });
  });

  it("returns a not-found response for unknown request ids", async () => {
    const handle = createApprovalWorkflowHandler();

    const approved = await handle({
      method: "POST",
      path: "/approval-requests/apr-missing/approve",
      headers: {
        "x-user-id": "manager-1",
        "x-user-role": "manager",
      },
    });

    expect(approved.status).toBe(404);
    expect(approved.body).toMatchObject({
      error: {
        code: "request_not_found",
      },
    });
  });

  it("keeps rejection behavior behind the same adapter boundary", async () => {
    const handle = createApprovalWorkflowHandler({
      now: fixedNow,
      idGenerator: () => "apr-http-reject",
    });

    await handle(createRequest());

    const rejected = await handle({
      method: "POST",
      path: "/approval-requests/apr-http-reject/reject",
      headers: {
        "x-user-id": "manager-1",
        "x-user-role": "manager",
      },
      body: {
        reason: "Vendor is not approved for this cost center.",
      },
    });

    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      id: "apr-http-reject",
      state: "rejected",
      audit: [
        { actorId: "user-1", action: "submitted" },
        {
          actorId: "manager-1",
          action: "rejected",
          note: "Vendor is not approved for this cost center.",
        },
      ],
    });
  });
});

function createRequest(overrides: Partial<Record<string, unknown>> = {}): HttpRequest {
  return {
    method: "POST",
    path: "/approval-requests",
    body: {
      title: "Database access for reporting",
      amount: 950,
      requesterId: "user-1",
      costCenter: "CC-0420",
      justification: "Reporting support requires temporary database access.",
      ...overrides,
    },
  };
}
