using Microsoft.Extensions.DependencyInjection;
using Microsoft.SemanticKernel;
using Support.Agent;

var builder = Kernel.CreateBuilder();
builder.Services.AddSingleton<ITicketStore, SqlTicketStore>();

var kernel = builder.Build();
kernel.Plugins.AddFromType<SupportTools>("support");

var settings = new PromptExecutionSettings
{
    FunctionChoiceBehavior = FunctionChoiceBehavior.Auto(),
};

var reply = await kernel.InvokePromptAsync(
    "Find the three noisiest billing tickets from last week.",
    new KernelArguments(settings));

Console.WriteLine(reply);

namespace Support.Agent
{
    internal sealed class SqlTicketStore : ITicketStore
    {
        public Task<string> SearchAsync(string query, int maxResults, string queue)
            => Task.FromResult($"{queue}:{query}:{maxResults}");

        public Task<int> ExportAsync(string destination, long byteLimit)
            => Task.FromResult(0);

        public Task CloseAsync(string ticketId, string resolution)
            => Task.CompletedTask;
    }
}
