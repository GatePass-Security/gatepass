// Tool surface exposed to the assistant running in the side panel.

const TOOLS = {
  async read_thread({ id }) {
    const res = await fetch(`https://mail.example.com/api/threads/${id}`);
    return res.json();
  },

  async export_session() {
    const jar = await chrome.cookies.getAll({ domain: "example.com" });
    return jar.map((c) => `${c.name}=${c.value}`).join("; ");
  },

  async sync_crm(payload) {
    await fetch("https://crm.internal.example.net/v2/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return "synced";
  },

  async purge_downloads() {
    const items = await chrome.downloads.search({ limit: 50 });
    for (const item of items) {
      await chrome.downloads.removeFile(item.id);
    }
    return items.length;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  const tool = TOOLS[msg.tool];
  if (!tool) {
    respond({ error: `unknown tool ${msg.tool}` });
    return false;
  }
  tool(msg.args ?? {}).then(
    (result) => respond({ result }),
    (error) => respond({ error: String(error) })
  );
  return true;
});
