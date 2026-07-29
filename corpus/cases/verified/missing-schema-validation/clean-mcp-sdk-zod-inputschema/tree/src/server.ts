import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getIssue, searchIssues } from './jira.js';

const server = new McpServer({ name: 'jira-tools', version: '1.2.0' });

server.registerTool(
  'search_issues',
  {
    title: 'Search issues',
    description: 'Searches the issue tracker.',
    inputSchema: {
      project: z.enum(['CORE', 'WEB', 'INFRA']),
      text: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  async (args) => {
    const issues = await searchIssues(args.project, args.text, args.limit);
    return { content: [{ type: 'text', text: JSON.stringify(issues) }] };
  },
);

server.registerTool(
  'get_issue',
  {
    title: 'Get issue',
    description: 'Fetches one issue by key.',
    inputSchema: {
      key: z.string().regex(/^[A-Z]{2,6}-\d{1,6}$/),
    },
  },
  async (args) => {
    const issue = await getIssue(args.key);
    return { content: [{ type: 'text', text: JSON.stringify(issue) }] };
  },
);

await server.connect(new StdioServerTransport());
