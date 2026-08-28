import type { ApprovalRequest } from "../domain/approval-workflow.js";

export class InMemoryApprovalRequestRepository {
  private readonly requests = new Map<string, ApprovalRequest>();

  async get(requestId: string): Promise<ApprovalRequest | undefined> {
    return this.requests.get(requestId);
  }

  async save(request: ApprovalRequest): Promise<void> {
    this.requests.set(request.id, request);
  }
}
