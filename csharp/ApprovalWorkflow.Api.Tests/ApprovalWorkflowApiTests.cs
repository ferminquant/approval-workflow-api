using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using ApprovalWorkflow;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

public sealed class ApprovalWorkflowApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly HttpClient _client;

    public ApprovalWorkflowApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task RunsCreateAndApprovePathThroughMinimalApiBoundary()
    {
        var created = await _client.PostAsJsonAsync("/approval-requests", StandardInput(), JsonOptions);

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var createdRequest = await created.Content.ReadFromJsonAsync<ApprovalRequest>(JsonOptions);
        Assert.NotNull(createdRequest);
        Assert.Equal(ApprovalState.Pending, createdRequest.State);

        using var approval = new HttpRequestMessage(
            HttpMethod.Post,
            $"/approval-requests/{createdRequest.Id}/approve");
        approval.Headers.Add("x-user-id", "manager-1");
        approval.Headers.Add("x-user-role", "manager");

        var approved = await _client.SendAsync(approval);

        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);

        var approvedRequest = await approved.Content.ReadFromJsonAsync<ApprovalRequest>(JsonOptions);
        Assert.NotNull(approvedRequest);
        Assert.Equal(ApprovalState.Approved, approvedRequest.State);
        Assert.Equal(2, approvedRequest.Version);
    }

    [Fact]
    public async Task ReturnsBusinessRuleResponseWhenFinanceApprovalIsRequired()
    {
        var created = await _client.PostAsJsonAsync("/approval-requests", StandardInput() with
        {
            Amount = 7200
        }, JsonOptions);
        var createdRequest = await created.Content.ReadFromJsonAsync<ApprovalRequest>(JsonOptions);
        Assert.NotNull(createdRequest);

        using var approval = new HttpRequestMessage(
            HttpMethod.Post,
            $"/approval-requests/{createdRequest.Id}/approve");
        approval.Headers.Add("x-user-id", "manager-1");
        approval.Headers.Add("x-user-role", "manager");

        var approved = await _client.SendAsync(approval);

        Assert.Equal((HttpStatusCode)422, approved.StatusCode);

        var error = await approved.Content.ReadFromJsonAsync<ApiErrorBody>(JsonOptions);
        Assert.NotNull(error);
        Assert.Equal("finance_review_required", error.Error.Code);
        Assert.Equal("Route to a finance approver.", error.Error.NextAction);
    }

    private static ApprovalRequestInput StandardInput() => new()
    {
        Title = "Database access for reporting",
        Amount = 950,
        RequesterId = "user-1",
        CostCenter = "CC-0420",
        Justification = "Reporting support requires temporary database access."
    };
}
