import { describe, expect, it } from "vitest";
import {
  type ApprovalRequest,
  approveRequest,
  createApprovalRequest,
  rejectRequest,
} from "../src/domain/approval-workflow.js";

const fixedNow = () => new Date("2026-01-15T10:30:00.000Z");

describe("approval workflow domain", () => {
  it("creates and approves a standard request with explicit state and audit changes", () => {
    const created = createApprovalRequest(standardInput(), {
      id: "apr-standard",
      now: fixedNow,
    });

    expect(created.status).toBe(201);

    const approved = approveRequest(created.body as ApprovalRequest, {
      userId: "manager-1",
      role: "manager",
    }, {
      now: fixedNow,
    });

    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      id: "apr-standard",
      state: "approved",
      version: 2,
      audit: [
        { actorId: "user-1", action: "submitted" },
        { actorId: "manager-1", action: "approved" },
      ],
    });
  });

  it("routes high-value requests to finance instead of accepting manager approval", () => {
    const created = createApprovalRequest(
      {
        ...standardInput(),
        amount: 7200,
      },
      {
        id: "apr-finance",
        now: fixedNow,
      },
    );

    const approved = approveRequest(created.body as ApprovalRequest, {
      userId: "manager-1",
      role: "manager",
    });

    expect(approved.status).toBe(422);
    expect(approved.body).toMatchObject({
      error: {
        code: "finance_review_required",
        details: {
          requiredApprovalRole: "finance",
        },
        nextAction: "Route to a finance approver.",
      },
    });
  });

  it("rejects callers that do not have an approval role", () => {
    const created = createApprovalRequest(standardInput(), {
      id: "apr-unauthorized",
      now: fixedNow,
    });

    const approved = approveRequest(created.body as ApprovalRequest, {
      userId: "user-2",
      role: "requester",
    });

    expect(approved.status).toBe(403);
    expect(approved.body).toMatchObject({
      error: {
        code: "approval_role_required",
      },
    });
  });

  it("returns validation detail for malformed create requests", () => {
    const created = createApprovalRequest({
      ...standardInput(),
      costCenter: "bad",
    });

    expect(created.status).toBe(422);
    expect(created.body).toMatchObject({
      error: {
        code: "validation_failed",
        details: {
          field: "costCenter",
        },
      },
    });
  });

  it("keeps rejection reasons in the audit trail", () => {
    const created = createApprovalRequest(standardInput(), {
      id: "apr-rejected",
      now: fixedNow,
    });

    const rejected = rejectRequest(
      created.body as ApprovalRequest,
      { userId: "manager-1", role: "manager" },
      "Vendor is not approved for this cost center.",
      { now: fixedNow },
    );

    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
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

function standardInput() {
  return {
    title: "Database access for reporting",
    amount: 950,
    requesterId: "user-1",
    costCenter: "CC-0420",
    justification: "Reporting support requires temporary database access.",
  };
}
