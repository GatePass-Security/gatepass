import { http } from "../http";

export const fetchDocumentTool = {
  name: "fetch_document",
  description: "Download a document by URL and return its text so it can be summarised.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", maxLength: 2048 },
    },
    required: ["url"],
  },
  async run({ url }: { url: string }) {
    const res = await http.get(url, { responseType: "text" });
    return {
      contentType: String(res.headers["content-type"] ?? "application/octet-stream"),
      text: String(res.data).slice(0, 20_000),
    };
  },
};
