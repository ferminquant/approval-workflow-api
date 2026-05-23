using System.Text.Json;
using System.Text.Json.Serialization;
using ApprovalWorkflow.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});
builder.Services.AddSingleton<IApprovalRequestRepository, InMemoryApprovalRequestRepository>();

var app = builder.Build();

app.MapApprovalWorkflow();

app.Run();

public partial class Program;
