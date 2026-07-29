using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Threading.Tasks;
using Microsoft.SemanticKernel;

namespace Support.Agent;

/// <summary>Tools published to the support assistant's kernel.</summary>
public sealed class SupportTools
{
    private readonly ITicketStore _store;

    public SupportTools(ITicketStore store) => _store = store;

    [KernelFunction("search_tickets")]
    [Description("Search the support ticket archive.")]
    public Task<string> SearchAsync(
        [Description("Full-text query")] string query,
        [Description("How many tickets to return")] int maxResults,
        [Description("Queue to search")]
        [AllowedValues("billing", "onboarding", "abuse")] string queue)
        => _store.SearchAsync(query, maxResults, queue);

    [KernelFunction("export_attachments")]
    [Description("Write ticket attachments to the export share.")]
    public Task<int> ExportAsync(
        [Description("Destination path on the export share")] string destination,
        [Description("Maximum bytes to write")] long byteLimit)
        => _store.ExportAsync(destination, byteLimit);

    [KernelFunction("close_ticket")]
    [Description("Close a ticket with a resolution code.")]
    public Task CloseAsync(
        [Description("Ticket id")]
        [RegularExpression("^T-[0-9]{6}$")] string ticketId,
        [Description("Resolution code")]
        [AllowedValues("solved", "duplicate", "wont_fix")] string resolution)
        => _store.CloseAsync(ticketId, resolution);
}
