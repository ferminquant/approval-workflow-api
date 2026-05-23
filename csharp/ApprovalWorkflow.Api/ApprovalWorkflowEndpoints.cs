using ApprovalWorkflow;
using Microsoft.AspNetCore.Http.HttpResults;

namespace ApprovalWorkflow.Api;

public interface IApprovalRequestRepository
{
    Task<ApprovalRequest?> Get(string requestId);
    Task Save(ApprovalRequest request);
}

public sealed class InMemoryApprovalRequestRepository : IApprovalRequestRepository
{
    private readonly Dictionary<string, ApprovalRequest> _requests = [];

    public Task<ApprovalRequest?> Get(string requestId) =>
        Task.FromResult(_requests.GetValueOrDefault(requestId));

    public Task Save(ApprovalRequest request)
    {
        _requests[request.Id] = request;
        return Task.CompletedTask;
    }
}

public sealed record RejectRequestInput(string? Reason);

public static class ApprovalWorkflowEndpoints
{
    public static IEndpointRouteBuilder MapApprovalWorkflow(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/approval-requests");

        // snippet:csharp-endpoints-start
        group.MapPost("/", async (
            ApprovalRequestInput input,
            IApprovalRequestRepository repository) =>
        {
            var result = ApprovalWorkflowEngine.CreateApprovalRequest(input);

            if (result.Body is ApprovalRequest request)
            {
                await repository.Save(request);
            }

            return Json(result);
        });

        group.MapPost("/{requestId}/approve", (
            string requestId,
            HttpRequest request,
            IApprovalRequestRepository repository) =>
            RunDecisionRoute(
                requestId,
                request,
                repository,
                (stored, actor) => ApprovalWorkflowEngine.ApproveRequest(stored, actor)));

        group.MapPost("/{requestId}/reject", (
            string requestId,
            HttpRequest request,
            RejectRequestInput body,
            IApprovalRequestRepository repository) =>
            RunDecisionRoute(
                requestId,
                request,
                repository,
                (stored, actor) => ApprovalWorkflowEngine.RejectRequest(stored, actor, body.Reason ?? "")));
        // snippet:csharp-endpoints-end

        return endpoints;
    }

    private static async Task<IResult> RunDecisionRoute(
        string requestId,
        HttpRequest request,
        IApprovalRequestRepository repository,
        Func<ApprovalRequest, Actor, ApiResult<ApprovalRequest>> operation)
    {
        var actor = ParseActor(request.Headers);

        if (actor is null)
        {
            return Results.Json(new ApiErrorBody(new ApiError(
                "actor_required",
                "Decision routes require x-user-id and x-user-role headers.")), statusCode: 401);
        }

        var stored = await repository.Get(requestId);

        if (stored is null)
        {
            return Results.Json(new ApiErrorBody(new ApiError(
                "request_not_found",
                "No approval request exists for the supplied id.")), statusCode: 404);
        }

        var result = operation(stored, actor);

        if (result.Body is ApprovalRequest changed)
        {
            await repository.Save(changed);
        }

        return Json(result);
    }

    private static Actor? ParseActor(IHeaderDictionary headers)
    {
        var userId = headers["x-user-id"].FirstOrDefault();
        var role = headers["x-user-role"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(userId) ||
            !Enum.TryParse<ApprovalRole>(role, ignoreCase: true, out var parsedRole))
        {
            return null;
        }

        return new Actor(userId, parsedRole);
    }

    private static JsonHttpResult<object> Json<T>(ApiResult<T> result) =>
        TypedResults.Json(result.Body, statusCode: result.Status);
}
