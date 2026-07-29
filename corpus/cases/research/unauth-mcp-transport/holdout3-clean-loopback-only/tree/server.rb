# A local-only MCP bridge for a desktop app. It speaks HTTP (which can look like
# an exposed network transport) but binds to the loopback interface only, so
# nothing off the host can reach it. The trust boundary is the machine itself;
# no token is needed because the port is not reachable remotely.

require "webrick"
require "json"

TOOLS = { "get_clipboard" => -> { { text: "" } } }

server = WEBrick::HTTPServer.new(
  BindAddress: "127.0.0.1", # loopback only — not 0.0.0.0
  Port: 7331
)

server.mount_proc "/mcp" do |req, res|
  body = JSON.parse(req.body || "{}")
  tool = TOOLS[body["tool"]]
  res.body = JSON.generate(tool ? tool.call : { error: "unknown tool" })
  res["Content-Type"] = "application/json"
end

trap("INT") { server.shutdown }
server.start
