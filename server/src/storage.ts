import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { config } from './config.js';

export const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true, // required by the Zerops (MinIO) backend
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

export async function putObject(key: string, body: Buffer | string, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<{ body: Readable; contentType?: string; length?: number } | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return { body: out.Body as Readable, contentType: out.ContentType, length: out.ContentLength };
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}
