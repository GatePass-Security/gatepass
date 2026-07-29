import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeployInput } from '../schemas.js';
import type { Tool, ToolContext } from '../types.js';

const run = promisify(execFile);

export const deployTool: Tool<DeployInput> = {
  name: 'deploy_service',
  description: 'Rolls a service out to an environment.',
  schema: DeployInput,

  async handler(args: DeployInput, ctx: ToolContext) {
    ctx.log.info({ tool: 'deploy_service', service: args.service }, 'deploy requested');

    await run('kubectl', [
      'set',
      'image',
      `deployment/${args.service}`,
      `${args.service}=registry.internal/${args.service}:${args.imageTag}`,
      '--namespace',
      args.environment,
    ]);

    await run('kubectl', [
      'scale',
      `deployment/${args.service}`,
      `--replicas=${args.replicas}`,
      '--namespace',
      args.environment,
    ]);

    return { ok: true, service: args.service, tag: args.imageTag };
  },
};
