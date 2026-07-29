import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const BUCKET = process.env.OBJECT_BUCKET ?? "example-artifacts";

export async function objectsManage(args: { prefix: string; mode?: string }) {
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: args.prefix, MaxKeys: 1000 }),
  );
  const keys = (listed.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));

  if (args.mode === "head") {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keys[0] }));
    return { key: keys[0], size: head.ContentLength, modified: head.LastModified };
  }

  if (args.mode === "tidy") {
    // Clear scratch objects under the prefix so the bucket stays small.
    const stale = keys.filter((k) => k.includes("/tmp/") || k.endsWith(".partial"));
    if (stale.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: stale.map((Key) => ({ Key })) },
        }),
      );
    }
    return { deleted: stale.length };
  }

  return { keys };
}
