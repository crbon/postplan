/**
 * Minimal SigV4 query-string presigner for S3, built on Web Crypto so it runs in
 * Convex's default runtime -- no "use node", no AWS SDK bundle.
 */

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

export type S3Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  prefix: string;
  endpoint: string;
};

export function s3Config(): S3Config {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const prefix = process.env.S3_PREFIX;
  const endpoint = process.env.S3_ENDPOINT;
  if (!accessKeyId || !secretAccessKey || !bucket || !region || !prefix || !endpoint) {
    throw new Error(
      "R2 env vars missing. Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION, S3_PREFIX and S3_ENDPOINT with `pnpm exec convex env set --prod`.",
    );
  }
  if (region !== "auto") throw new Error("S3_REGION must be auto for R2.");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) ||
    url.port || url.pathname !== "/" || url.search || url.hash ||
    url.username || url.password
  ) {
    throw new Error("S3_ENDPOINT must be the R2 account URL: https://<account-id>.r2.cloudflarestorage.com");
  }
  return { accessKeyId, secretAccessKey, bucket, region, prefix, endpoint: url.origin };
}

/** Percent-encode per RFC 3986; S3 keeps "/" literal in the canonical URI. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
      "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    ))
    .join("/");
}

/**
 * A presigned URL for one object. `expiresIn` is capped at 7 days by AWS, which is
 * also this project's transfer lifetime.
 */
export async function presign(
  config: S3Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  expiresIn: number,
  contentType?: string,
): Promise<string> {
  const host = new URL(config.endpoint).host;
  const path = encodePath(`/${config.bucket}/${key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;

  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(expiresIn, 604800)),
    "X-Amz-SignedHeaders": contentType ? "content-type;host" : "host",
  });
  // S3 requires the canonical query string sorted by key.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, value]) => `${encodeURIComponent(k)}=${encodeURIComponent(value)}`)
    .join("&");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `${contentType ? `content-type:${contentType}\n` : ""}host:${host}\n`,
    contentType ? "content-type;host" : "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey = await hmac(
    encoder.encode(`AWS4${config.secretAccessKey}`).buffer as ArrayBuffer,
    dateStamp,
  );
  for (const part of [config.region, "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, part);
  }
  const signature = hex(await hmac(signingKey, stringToSign));

  return `${config.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Object key for one draft version, addressed by content hash. */
export function draftKey(config: S3Config, draftId: string, sha256: string): string {
  return `${config.prefix}/${draftId}/${sha256}.html`;
}
