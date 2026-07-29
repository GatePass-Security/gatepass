import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';

export const ReadFileInput = z.object({
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  path: z.string(),
  maxBytes: z.number().int().min(1).max(1_048_576).default(65_536),
});

export const WriteFileInput = z.object({
  path: z.string().max(4096),
  mode: z.enum(['create', 'overwrite', 'append']),
  contents: z.string(),
});

export async function readFileTool(input: z.infer<typeof ReadFileInput>) {
  const buf = await readFile(input.path);
  return { text: buf.subarray(0, input.maxBytes).toString(input.encoding) };
}

export async function writeFileTool(input: z.infer<typeof WriteFileInput>) {
  await writeFile(input.path, input.contents, {
    flag: input.mode === 'append' ? 'a' : input.mode === 'create' ? 'wx' : 'w',
  });
  return { bytes: Buffer.byteLength(input.contents) };
}
