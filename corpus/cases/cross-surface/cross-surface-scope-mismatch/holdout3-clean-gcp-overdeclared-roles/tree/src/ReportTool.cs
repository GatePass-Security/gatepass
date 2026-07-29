using System.IO;
using System.Text;
using System.Threading.Tasks;
using Google.Cloud.BigQuery.V2;
using Google.Cloud.Storage.V1;

namespace ReportAgent;

/// <summary>
/// Agent tool surface. Read-only by construction: no upload, delete or
/// insert call is reachable from here.
/// </summary>
public sealed class ReportTool
{
    private readonly StorageClient _storage;
    private readonly BigQueryClient _bigQuery;

    public ReportTool(StorageClient storage, BigQueryClient bigQuery)
    {
        _storage = storage;
        _bigQuery = bigQuery;
    }

    /// <summary>Tool: fetch_manifest</summary>
    public async Task<string> FetchManifestAsync(string bucket, string objectName)
    {
        using var buffer = new MemoryStream();
        await _storage.DownloadObjectAsync(bucket, objectName, buffer);
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    /// <summary>Tool: table_size</summary>
    public async Task<ulong> TableSizeAsync(string dataset, string table)
    {
        var reference = await _bigQuery.GetTableAsync(dataset, table);
        return reference.Resource.NumRows ?? 0UL;
    }
}
