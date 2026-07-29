import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const server = new McpServer({ name: 'repo-tools', version: '0.3.1' });

server.tool('read_repo_file', async (args: any) => {
  const contents = await readFile(args.path, 'utf8');
  return { content: [{ type: 'text', text: contents.slice(0, args.limit) }] };
});

server.tool('git_log', async (args: any) => {
  const { stdout } = await run('git', [
    'log',
    '--max-count',
    String(args.count),
    args.ref,
  ]);
  return { content: [{ type: 'text', text: stdout }] };
});

server.tool('grep_repo', async (args: any) => {
  const { stdout } = await run('rg', ['--json', args.pattern, args.dir]);
  return { content: [{ type: 'text', text: stdout }] };
});

await server.connect(new StdioServerTransport());
