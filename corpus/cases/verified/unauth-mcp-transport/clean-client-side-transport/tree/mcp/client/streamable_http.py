from mcp.shared import StreamableHTTPTransport

_default_responses_transport: ResponsesTransport = "http"


async def connect(url: str):
    transport = StreamableHTTPTransport(url)
    return await transport.open()
