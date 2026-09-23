import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { draftKey, presign, s3Config, type S3Config } from "../convex/lib/s3.ts";

const config: S3Config = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "private-bucket",
  region: "auto",
  prefix: "drafts",
  endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
};

function expectedSignature(url: URL, method: string, contentType?: string): string {
  const params = [...url.searchParams.entries()]
    .filter(([key]) => key !== "X-Amz-Signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const signedHeaders = contentType ? "content-type;host" : "host";
  const headers = `${contentType ? `content-type:${contentType}\n` : ""}host:${url.host}\n`;
  const request = [method, url.pathname, params, headers, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const date = url.searchParams.get("X-Amz-Date")!;
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const hash = createHash("sha256").update(request).digest("hex");
  const message = ["AWS4-HMAC-SHA256", date, scope, hash].join("\n");
  const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
  let key = hmac(`AWS4${config.secretAccessKey}`, date.slice(0, 8));
  for (const part of ["auto", "s3", "aws4_request"]) key = hmac(key, part);
  return createHmac("sha256", key).update(message).digest("hex");
}

test("R2 configuration requires an account endpoint and auto region", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      S3_ACCESS_KEY_ID: config.accessKeyId,
      S3_SECRET_ACCESS_KEY: config.secretAccessKey,
      S3_BUCKET: config.bucket,
      S3_REGION: config.region,
      S3_PREFIX: config.prefix,
      S3_ENDPOINT: config.endpoint,
    });
    assert.deepEqual(s3Config(), config);
    process.env.S3_REGION = "us-east-1";
    assert.throws(s3Config, /must be auto/);
    process.env.S3_REGION = "auto";
    process.env.S3_ENDPOINT = "https://example.com";
    assert.throws(s3Config, /R2 account URL/);
  } finally {
    process.env = previous;
  }
});

test("presigned R2 URLs keep the draft key and sign the exact host, path, and method", async () => {
  const key = draftKey(config, "draft-123", "abc123");
  assert.equal(key, "drafts/draft-123/abc123.html");

  for (const [method, contentType] of [
    ["PUT", "text/html; charset=utf-8"],
    ["GET", undefined],
    ["DELETE", undefined],
  ] as const) {
    const url = new URL(await presign(config, method, key, 300, contentType));
    assert.equal(url.origin, config.endpoint);
    assert.equal(url.pathname, `/private-bucket/${key}`);
    assert.equal(url.searchParams.get("X-Amz-Content-Sha256"), "UNSIGNED-PAYLOAD");
    assert.equal(url.searchParams.get("X-Amz-Credential")?.split("/")[2], "auto");
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), contentType ? "content-type;host" : "host");
    assert.equal(url.searchParams.get("X-Amz-Signature"), expectedSignature(url, method, contentType));
    assert.notEqual(url.searchParams.get("X-Amz-Signature"), expectedSignature(url, "HEAD", contentType));
  }
});

test("object paths preserve slashes and encode special characters", async () => {
  const url = new URL(await presign(config, "GET", "drafts/a b/é.html", 60));
  assert.equal(url.pathname, "/private-bucket/drafts/a%20b/%C3%A9.html");
  assert.equal(url.searchParams.get("X-Amz-Signature"), expectedSignature(url, "GET"));
});
