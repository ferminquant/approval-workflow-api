using System.Text.RegularExpressions;

namespace ApprovalWorkflow;

public enum ApprovalState
{
    Pending,
    Approved,
    Rejected
}

public enum ApprovalRole
{
    Requester,
    Manager,
    Finance
}

public enum AuditAction
{
    Submitted,
    Approved,
    Rejected
}

public sealed record ApprovalRequestInput
{
    public string Title { get; init; } = "";
    public decimal Amount { get; init; }
    public string RequesterId { get; init; } = "";
    public string CostCenter { get; init; } = "";
    public string Justification { get; init; } = "";
}

public sealed record Actor(string UserId, ApprovalRole Role);

public sealed record AuditEvent(
    string ActorId,
    AuditAction Action,
    DateTimeOffset At,
    string? Note = null);

public sealed record ApprovalRequest(
    string Id,
    string Title,
    decimal Amount,
    string RequesterId,
    string CostCenter,
    string Justification,
    ApprovalRole RequiredApprovalRole,
    ApprovalState State,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int Version,
    IReadOnlyList<AuditEvent> Audit);

public sealed record ApiError(
    string Code,
    string Message,
    IReadOnlyDictionary<string, object>? Details = null,
    string? NextAction = null);

public sealed record ApiErrorBody(ApiError Error);

public sealed record ApiResult<T>(int Status, object Body);

public sealed record OperationOptions(Func<DateTimeOffset>? Now = null);

public sealed record CreateOptions(Func<DateTimeOffset>? Now = null, string? Id = null);

public static class ApprovalWorkflowEngine
{
    // snippet:csharp-create-request-start
    public static ApiResult<ApprovalRequest> CreateApprovalRequest(
        ApprovalRequestInput input,
        CreateOptions? options = null)
    {
        var validation = ValidateInput(input);

        if (validation is { } error)
        {
            return Failure<ApprovalRequest>(422, "validation_failed", error.Message, new Dictionary<string, object>
            {
                ["field"] = error.Field
            });
        }

        var at = Timestamp(options?.Now);
        var request = new ApprovalRequest(
            Id: options?.Id ?? Guid.NewGuid().ToString("n"),
            Title: input.Title,
            Amount: input.Amount,
            RequesterId: input.RequesterId,
            CostCenter: input.CostCenter,
            Justification: input.Justification,
            RequiredApprovalRole: input.Amount > 2500 ? ApprovalRole.Finance : ApprovalRole.Manager,
            State: ApprovalState.Pending,
            CreatedAt: at,
            UpdatedAt: at,
            Version: 1,
            Audit:
            [
                new AuditEvent(input.RequesterId, AuditAction.Submitted, at)
            ]);

        return new ApiResult<ApprovalRequest>(201, request);
    }
    // snippet:csharp-create-request-end

    // snippet:csharp-approve-request-start
    public static ApiResult<ApprovalRequest> ApproveRequest(
        ApprovalRequest request,
        Actor actor,
        OperationOptions? options = null)
    {
        if (actor.Role == ApprovalRole.Requester)
        {
            return Failure<ApprovalRequest>(
                403,
                "approval_role_required",
                "Only manager or finance roles can approve requests.");
        }

        if (request.State != ApprovalState.Pending)
        {
            return Failure<ApprovalRequest>(
                409,
                "request_not_pending",
                "Only pending requests can be approved.",
                new Dictionary<string, object> { ["currentState"] = request.State.ToString().ToLowerInvariant() });
        }

        if (actor.UserId == request.RequesterId)
        {
            return Failure<ApprovalRequest>(
                409,
                "separation_of_duties_required",
                "A requester cannot approve their own request.");
        }

        if (request.RequiredApprovalRole == ApprovalRole.Finance && actor.Role != ApprovalRole.Finance)
        {
            return Failure<ApprovalRequest>(
                422,
                "finance_review_required",
                "This request exceeds the manager approval limit.",
                new Dictionary<string, object> { ["requiredApprovalRole"] = "finance" },
                "Route to a finance approver.");
        }

        var at = Timestamp(options?.Now);
        var approved = request with
        {
            State = ApprovalState.Approved,
            UpdatedAt = at,
            Version = request.Version + 1,
            Audit = [.. request.Audit, new AuditEvent(actor.UserId, AuditAction.Approved, at)]
        };

        return new ApiResult<ApprovalRequest>(200, approved);
    }
    // snippet:csharp-approve-request-end

    public static ApiResult<ApprovalRequest> RejectRequest(
        ApprovalRequest request,
        Actor actor,
        string reason,
        OperationOptions? options = null)
    {
        if (actor.Role == ApprovalRole.Requester)
        {
            return Failure<ApprovalRequest>(
                403,
                "approval_role_required",
                "Only manager or finance roles can reject requests.");
        }

        if (request.State != ApprovalState.Pending)
        {
            return Failure<ApprovalRequest>(
                409,
                "request_not_pending",
                "Only pending requests can be rejected.",
                new Dictionary<string, object> { ["currentState"] = request.State.ToString().ToLowerInvariant() });
        }

        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length < 12)
        {
            return Failure<ApprovalRequest>(
                422,
                "validation_failed",
                "A rejection reason must be specific enough to act on.",
                new Dictionary<string, object> { ["field"] = "reason" });
        }

        var at = Timestamp(options?.Now);
        var rejected = request with
        {
            State = ApprovalState.Rejected,
            UpdatedAt = at,
            Version = request.Version + 1,
            Audit = [.. request.Audit, new AuditEvent(actor.UserId, AuditAction.Rejected, at, reason.Trim())]
        };

        return new ApiResult<ApprovalRequest>(200, rejected);
    }

    private static (string Field, string Message)? ValidateInput(ApprovalRequestInput input)
    {
        if (input is null)
        {
            return ("body", "A JSON request body is required.");
        }

        if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Trim().Length < 8)
        {
            return ("title", "A title of at least 8 characters is required.");
        }

        if (input.Amount <= 0)
        {
            return ("amount", "Amount must be greater than zero.");
        }

        if (string.IsNullOrWhiteSpace(input.RequesterId) || input.RequesterId.Trim().Length < 3)
        {
            return ("requesterId", "Requester identity is required.");
        }

        if (!Regex.IsMatch(input.CostCenter, "^CC-\\d{4}$"))
        {
            return ("costCenter", "Cost center must match CC-0000 format.");
        }

        if (string.IsNullOrWhiteSpace(input.Justification) || input.Justification.Trim().Length < 20)
        {
            return ("justification", "Justification must explain the business need.");
        }

        return null;
    }

    private static DateTimeOffset Timestamp(Func<DateTimeOffset>? now) =>
        now?.Invoke() ?? DateTimeOffset.UtcNow;

    private static ApiResult<T> Failure<T>(
        int status,
        string code,
        string message,
        IReadOnlyDictionary<string, object>? details = null,
        string? nextAction = null) =>
        new(status, new ApiErrorBody(new ApiError(code, message, details, nextAction)));
}
