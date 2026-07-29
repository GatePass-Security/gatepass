using System.Threading.Tasks;

namespace Support.Agent;

public interface ITicketStore
{
    /// <summary>Runs a full-text search and serialises the hits.</summary>
    Task<string> SearchAsync(string query, int maxResults, string queue);

    /// <summary>Copies attachments to <paramref name="destination"/>.</summary>
    Task<int> ExportAsync(string destination, long byteLimit);

    /// <summary>Marks a ticket closed.</summary>
    Task CloseAsync(string ticketId, string resolution);
}
