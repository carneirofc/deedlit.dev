import { Readable } from "node:stream";

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { getLogger } from "@/lib/logger";
import { getLibraryConfig } from "@/lib/library/config";

const logger = getLogger({ scope: "library-object-store" });

declare global {
  var __comfyhelperS3Client: S3Client | undefined;
  var __comfyhelperS3BucketReady: boolean | undefined;
}

export function isObjectStoreEnabled(): boolean {
  return getLibraryConfig().objectStore.enabled;
}

export function getClient(): S3Client {
  if (!globalThis.__comfyhelperS3Client) {
    const { objectStore } = getLibraryConfig();
    globalThis.__comfyhelperS3Client = new S3Client({
      endpoint: objectStore.endpoint,
      region: objectStore.region,
      forcePathStyle: objectStore.forcePathStyle,
      credentials: { accessKeyId: objectStore.accessKey, secretAccessKey: objectStore.secretKey },
    });
  }
  return globalThis.__comfyhelperS3Client;
}

/** Create the bucket if it does not exist (idempotent, cached per process). */
export async function ensureBucket(): Promise<void> {
  if (globalThis.__comfyhelperS3BucketReady) return;
  const { objectStore } = getLibraryConfig();
  const client = getClient();
  try {
    await client.send(new HeadBucketCommand({ Bucket: objectStore.bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: objectStore.bucket }));
    } catch (error) {
      // Another process may have created it concurrently — tolerate.
      logger.warn({ err: error, bucket: objectStore.bucket }, "ensureBucket create failed");
    }
  }
  globalThis.__comfyhelperS3BucketReady = true;
}

/** `s3://bucket/key` URI used as a portable pointer stored in PostgreSQL. */
export function objectUri(key: string): string {
  return `s3://${getLibraryConfig().objectStore.bucket}/${key}`;
}

export function parseObjectUri(uri: string): { bucket: string; key: string } | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<string> {
  await ensureBucket();
  const { objectStore } = getLibraryConfig();
  await getClient().send(
    new PutObjectCommand({ Bucket: objectStore.bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return objectUri(key);
}

export async function objectExists(key: string): Promise<boolean> {
  const { objectStore } = getLibraryConfig();
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: objectStore.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function getBody(bucket: string, key: string) {
  const res = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body;
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const { objectStore } = getLibraryConfig();
  try {
    const body = await getBody(objectStore.bucket, key);
    if (!body) return null;
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

/** Web ReadableStream for an `s3://…` URI, suitable for a Response body. */
export async function getObjectWebStream(uri: string): Promise<ReadableStream | null> {
  const parsed = parseObjectUri(uri);
  if (!parsed) return null;
  try {
    const body = await getBody(parsed.bucket, parsed.key);
    if (!body) return null;
    // AWS SDK v3 in Node returns a Node Readable; convert to a web stream.
    if (body instanceof Readable) {
      return Readable.toWeb(body) as unknown as ReadableStream;
    }
    return body as unknown as ReadableStream;
  } catch (error) {
    logger.warn({ err: error, uri }, "getObjectWebStream failed");
    return null;
  }
}

export async function pingObjectStore(): Promise<boolean> {
  if (!isObjectStoreEnabled()) return false;
  try {
    await ensureBucket();
    return true;
  } catch (error) {
    logger.warn({ err: error }, "object store ping failed");
    return false;
  }
}
