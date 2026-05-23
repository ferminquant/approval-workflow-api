using Xunit;

namespace ApprovalWorkflow.Tests;

public sealed class ApprovalWorkflowEngineTests
{
    // snippet:csharp-test-happy-path-start
    [Fact]
    public void CreatesAndApprovesStandardRequestWithExplicitStateAndAuditChanges()
    {
        var created = ApprovalWorkflowEngine.CreateApprovalRequest(StandardInput(), new CreateOptions(
            Now: FixedNow,
            Id: "apr-standard"));

        Assert.Equal(201, created.Status);

        var request = Assert.IsType<ApprovalRequest>(created.Body);
        var approved = ApprovalWorkflowEngine.ApproveRequest(
            request,
            new Actor("manager-1", ApprovalRole.Manager),
            new OperationOptions(FixedNow));

        Assert.Equal(200, approved.Status);

        var approvedRequest = Assert.IsType<ApprovalRequest>(approved.Body);
        Assert.Equal(ApprovalState.Approved, approvedRequest.State);
        Assert.Equal(2, approvedRequest.Version);
        Assert.Collection(
            approvedRequest.Audit,
            submitted => Assert.Equal(AuditAction.Submitted, submitted.Action),
            approval => Assert.Equal("manager-1", approval.ActorId));
    }
    // snippet:csharp-test-happy-path-end

    // snippet:csharp-test-finance-rule-start
    [Fact]
    public void RoutesHighValueRequestsToFinanceInsteadOfAcceptingManagerApproval()
    {
        var created = ApprovalWorkflowEngine.CreateApprovalRequest(StandardInput() with
        {
            Amount = 7200
        }, new CreateOptions(Now: FixedNow, Id: "apr-finance"));

        var request = Assert.IsType<ApprovalRequest>(created.Body);
        var approved = ApprovalWorkflowEngine.ApproveRequest(
            request,
            new Actor("manager-1", ApprovalRole.Manager));

        Assert.Equal(422, approved.Status);

        var error = Assert.IsType<ApiErrorBody>(approved.Body);
        Assert.Equal("finance_review_required", error.Error.Code);
        Assert.Equal("Route to a finance approver.", error.Error.NextAction);
        Assert.Equal("finance", error.Error.Details?["requiredApprovalRole"]);
    }
    // snippet:csharp-test-finance-rule-end

    // snippet:csharp-test-unauthorized-start
    [Fact]
    public void RejectsCallersThatDoNotHaveAnApprovalRole()
    {
        var created = ApprovalWorkflowEngine.CreateApprovalRequest(StandardInput(), new CreateOptions(
            Now: FixedNow,
            Id: "apr-unauthorized"));

        var request = Assert.IsType<ApprovalRequest>(created.Body);
        var approved = ApprovalWorkflowEngine.ApproveRequest(
            request,
            new Actor("user-2", ApprovalRole.Requester));

        Assert.Equal(403, approved.Status);

        var error = Assert.IsType<ApiErrorBody>(approved.Body);
        Assert.Equal("approval_role_required", error.Error.Code);
    }
    // snippet:csharp-test-unauthorized-end

    [Fact]
    public void ReturnsValidationDetailForMalformedCreateRequests()
    {
        var created = ApprovalWorkflowEngine.CreateApprovalRequest(StandardInput() with
        {
            CostCenter = "bad"
        });

        Assert.Equal(422, created.Status);

        var error = Assert.IsType<ApiErrorBody>(created.Body);
        Assert.Equal("validation_failed", error.Error.Code);
        Assert.Equal("costCenter", error.Error.Details?["field"]);
    }

    [Fact]
    public void KeepsRejectionReasonsInTheAuditTrail()
    {
        var created = ApprovalWorkflowEngine.CreateApprovalRequest(StandardInput(), new CreateOptions(
            Now: FixedNow,
            Id: "apr-rejected"));

        var request = Assert.IsType<ApprovalRequest>(created.Body);
        var rejected = ApprovalWorkflowEngine.RejectRequest(
            request,
            new Actor("manager-1", ApprovalRole.Manager),
            "Vendor is not approved for this cost center.",
            new OperationOptions(FixedNow));

        Assert.Equal(200, rejected.Status);

        var rejectedRequest = Assert.IsType<ApprovalRequest>(rejected.Body);
        Assert.Equal(ApprovalState.Rejected, rejectedRequest.State);
        Assert.Collection(
            rejectedRequest.Audit,
            submitted => Assert.Equal(AuditAction.Submitted, submitted.Action),
            rejection =>
            {
                Assert.Equal(AuditAction.Rejected, rejection.Action);
                Assert.Equal("Vendor is not approved for this cost center.", rejection.Note);
            });
    }

    private static DateTimeOffset FixedNow() =>
        DateTimeOffset.Parse("2026-01-15T10:30:00.000Z");

    private static ApprovalRequestInput StandardInput() => new()
    {
        Title = "Database access for reporting",
        Amount = 950,
        RequesterId = "user-1",
        CostCenter = "CC-0420",
        Justification = "Reporting support requires temporary database access."
    };
}
