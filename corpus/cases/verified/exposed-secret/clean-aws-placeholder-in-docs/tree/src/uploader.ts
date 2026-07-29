import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// No explicit credentials: the SDK resolves the task role in ECS and the
// AWS_* environment variables locally.
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

const BUCKET = process.env.UPLOAD_BUCKET ?? "acme-uploads";

export async function putAvatar(userId: string, body: Uint8Array) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `avatars/${userId}.png`,
      Body: body,
      ContentType: "image/png",
      CacheControl: "public, max-age=604800",
    }),
  );
  return `https://${BUCKET}.s3.amazonaws.com/avatars/${userId}.png`;
}
