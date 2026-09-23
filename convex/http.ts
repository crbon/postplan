import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateHtml } from "../src/html-policy.js";
import { draftKey, presign, s3Config, s3Host } from "./lib/s3";
import { uploadPage } from "./lib/uploadPage";
import { downloadPage } from "./lib/downloadPage";
import { dashboardPage, dashboardScript } from "./lib/dashboardPage";

/**
 * The Postplan API, served by Convex with R2 object storage.
 *
 * The CLI (`postplan-r2 upload`) speaks exactly three endpoints, so those are
 * reproduced byte-for-byte in shape. Convex functions replace express and Convex
 * tables replace Postgres; the HTML itself goes to R2, which removes Railway and
 * Postgres while keeping the bytes in the configured private bucket.
 */

const MAX_HTML_BYTES = Number(process.env.MAX_HTML_BYTES ?? 512 * 1024);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * Bearer auth. An unset POSTPLAN_API_KEY keeps the owner endpoints closed.
 */
function authorize(request: Request): { ok: true; account: string } | { ok: false } {
  const expected = process.env.POSTPLAN_API_KEY;
  if (!expected) return { ok: false };
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token && token === expected ? { ok: true, account: "owner" } : { ok: false };
}

function baseUrl(request: Request): string {
  return process.env.POSTPLAN_PUBLIC_BASE_URL ?? new URL(request.url).origin;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * A readable slug plus a random id: `physio-exercise-sheets-84gosen4`.
 *
 * The URL is the only credential, so a purely readable slug would be guessable by
 * anyone who knows what Aryan is working on -- the id is what makes it safe. With
 * nothing readable to work from, the id alone is the slug.
 *
 * This is the handle, not the primary key. The Convex document id still resolves
 * the same record (see the lookups in uploads.ts / drafts.ts), so a link is
 * recoverable even if the slug is lost.
 */
function newSlug(readable?: string): string {
  const base = (readable ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return base ? `${base}-${randomId()}` : randomId(12);
}

const http = httpRouter();

http.route({
  path: "/dashboard",
  method: "GET",
  handler: httpAction(async () =>
    new Response(dashboardPage, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    }),
  ),
});

http.route({
  path: "/dashboard.js",
  method: "GET",
  handler: httpAction(async () =>
    new Response(dashboardScript, {
      status: 200,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  ),
});

http.route({
  path: "/api/me",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    return json({ account_id: auth.account, plan: "self-hosted", backend: "convex" });
  }),
});

http.route({
  path: "/api/uploads",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return json({ error: "Invalid body." }, 400);
    const { html, filename, draftId, description, metadata } = body as Record<string, unknown>;

    if (typeof html !== "string" || !html.trim()) {
      return json({ error: "html is required." }, 400);
    }
    if (typeof filename !== "string" || !filename.trim()) {
      return json({ error: "filename is required." }, 400);
    }
    const bytes = new TextEncoder().encode(html).length;
    if (bytes > MAX_HTML_BYTES) {
      return json(
        { error: `HTML exceeds ${MAX_HTML_BYTES} bytes.`, errors: [`Got ${bytes} bytes.`] },
        413,
      );
    }

    // Re-validate server side. The CLI checks too, but a client check is only a
    // convenience -- this HTML is served from our own origin.
    const validation = validateHtml(html, {});
    if (!validation.ok) {
      return json({ error: "HTML failed Postplan validation.", errors: validation.errors }, 400);
    }

    const id =
      typeof draftId === "string" && draftId
        ? draftId
        : newSlug(filename.replace(/\.[a-z0-9]+$/i, ""));

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    // Bytes go to R2, addressed by content hash: uploading the same HTML twice
    // is idempotent, and a failed PUT leaves no row pointing at nothing.
    const config = s3Config();
    const key = draftKey(config, id, sha256);
    const contentType = "text/html; charset=utf-8";
    const put = await fetch(await presign(config, "PUT", key, 300, contentType), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: html,
    });
    if (!put.ok) return json({ error: `Storage upload failed (${put.status}).` }, 502);

    const { versionNumber } = await ctx.runMutation(internal.drafts.upsert, {
      draftId: id,
      filename,
      description: typeof description === "string" ? description : undefined,
      key,
      sha256,
      bytes,
      metadata: metadata ?? undefined,
      createdBy: auth.account,
    });

    const publicUrl = `${baseUrl(request)}/d/${id}`;
    return json({
      draftId: id,
      publicUrl,
      rawUrl: `${publicUrl}/raw`,
      versionNumber,
      warnings: validation.warnings ?? [],
    });
  }),
});

http.route({
  path: "/api/drafts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    return json({ drafts: await ctx.runQuery(internal.drafts.list, {}) });
  }),
});

/**
 * Upload requests. The page and its two endpoints are deliberately unauthenticated:
 * the slug is the credential, because whoever uploads is often not the person who
 * generated the link. Creating and reading a request still requires the API key.
 */
http.route({
  path: "/api/upload-requests",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const body: unknown = await request.json();
    const { reason, days } = (body ?? {}) as Record<string, unknown>;
    const { direction } = (body ?? {}) as Record<string, unknown>;
    const out = direction === "out";
    const slug = newSlug(typeof reason === "string" ? reason : undefined);
    await ctx.runMutation(internal.uploads.create, {
      slug,
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : undefined,
      createdBy: auth.account,
      days: typeof days === "number" ? days : 7,
      direction: out ? "out" : "in",
    });
    return json({ slug, url: `${baseUrl(request)}/${out ? "s" : "u"}/${slug}` });
  }),
});

http.route({
  path: "/api/upload-requests/list",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const body: unknown = await request.json();
    const { slug } = (body ?? {}) as Record<string, unknown>;
    if (typeof slug !== "string") return json({ error: "slug is required." }, 400);
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return json({ error: "no such upload link" }, 404);
    const config = s3Config();
    const files = await Promise.all(
      found.files.map(async (f) => ({
        name: f.name,
        size: f.size,
        contentType: f.contentType,
        url: await presign(config, "GET", f.key, 3600),
      })),
    );
    return json({ slug, reason: found.request.reason ?? null, expiresAt: found.request.expiresAt, files });
  }),
});

/** Mint a presigned PUT for the phone. No API key: the slug is the credential. */
http.route({
  pathPrefix: "/api/u/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const path = new URL(request.url).pathname;
    const match = path.match(/^\/api\/u\/([^/]+)\/(sign|record)$/);
    if (!match) return json({ error: "Not found." }, 404);
    const [, slug, action] = match;

    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return json({ error: "no such upload link" }, 404);
    if (found.request.expiresAt < Date.now()) return json({ error: "this link has expired" }, 410);

    const body: unknown = await request.json();
    const fields = (body ?? {}) as Record<string, unknown>;

    if (action === "sign") {
      const { name, contentType } = fields;
      if (typeof name !== "string" || typeof contentType !== "string") {
        return json({ error: "name and contentType are required." }, 400);
      }
      const config = s3Config();
      const suffix = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase().slice(0, 20) : "";
      const key = `${config.prefix}/uploads/${slug}/${found.files.length + 1}${suffix}`;
      return json({ key, url: await presign(config, "PUT", key, 3600, contentType) });
    }

    const { key, name, size, contentType } = fields;
    if (typeof key !== "string" || typeof name !== "string" || typeof size !== "number" || typeof contentType !== "string") {
      return json({ error: "key, name, size and contentType are required." }, 400);
    }
    await ctx.runMutation(internal.uploads.addFile, { slug, key, name, size, contentType });
    return json({ ok: true });
  }),
});

/**
 * The sandbox for our own two file pages.
 *
 * Same shape as the draft CSP below, with one deliberate hole: `connect-src` names
 * this origin (the sign and record calls) and the S3 bucket host derived from
 * `s3Config()` at request time, because the upload page PUTs bytes straight to S3
 * and the download page fetches text files to preview them. `blob:` is in `img-src`
 * and `media-src` so a picked file can be shown before it is sent. Everything else
 * is off: no frames in either direction, no forms, no workers, no base retargeting.
 * `frame-src 'none'` is why the PDF preview is a panel and not an iframe.
 */
const filePageCsp = (): string =>
  [
    "default-src 'none'",
    "img-src https: data: blob:",
    "media-src https: data: blob:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "script-src 'unsafe-inline'",
    `connect-src 'self' https://${s3Host(s3Config())}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "worker-src 'none'",
  ].join("; ");

const filePageHeaders = () => ({
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": filePageCsp(),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

/** A dead link or an expired one: same plain page, same headers. */
const filePageNotice = (title: string, text: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<meta name="color-scheme" content="dark"><title>${title}</title></head>`
      + `<body style="margin:0;background:#000;color:#898781;font:17px/1.5 system-ui,-apple-system,sans-serif">`
      + `<main style="width:min(560px,calc(100% - 32px));margin:0 auto;padding:44px 0">${text}</main></body></html>`,
    { status, headers: filePageHeaders() },
  );

/** The page someone opens to send files in. */
http.route({
  pathPrefix: "/u/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/u/".length).replace(/\/+$/, ""));
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return filePageNotice("Not found", "That link is not valid any more.", 404);
    if (found.request.expiresAt < Date.now()) {
      return filePageNotice("Expired", "This upload link has expired.", 410);
    }
    return new Response(
      uploadPage(slug, found.request.reason, found.files, found.request.expiresAt),
      { status: 200, headers: filePageHeaders() },
    );
  }),
});

/** Files an agent sent to Aryan: previewable on a phone, downloadable to keep. */
http.route({
  pathPrefix: "/s/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/s/".length).replace(/\/+$/, ""));
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return filePageNotice("Not found", "That link is not valid any more.", 404);
    if (found.request.expiresAt < Date.now()) {
      return filePageNotice("Expired", "This link has expired.", 410);
    }
    const config = s3Config();
    const files = await Promise.all(
      found.files.map(async (f) => ({
        name: f.name,
        size: f.size,
        contentType: f.contentType,
        url: await presign(config, "GET", f.key, 3600),
      })),
    );
    // "Sent" is when the last file landed; for an empty link, when the link was made.
    const sentAt = found.files.reduce(
      (latest, f) => Math.max(latest, f.uploadedAt),
      found.request._creationTime,
    );
    return new Response(
      downloadPage({
        reason: found.request.reason,
        files,
        sentAt,
        expiresAt: found.request.expiresAt,
      }),
      { status: 200, headers: filePageHeaders() },
    );
  }),
});

/**
 * The sandbox for served drafts, enforced by the browser.
 *
 * The upload policy (`src/html-policy.js`) allows inline classic `<script>`, so the
 * CSP has to keep `script-src 'unsafe-inline'` -- a draft's own scripts still run.
 * What it takes away is everything that script could reach out with: `connect-src
 * 'none'` kills fetch/XHR/WebSocket/beacon, `frame-src`/`frame-ancestors 'none'`
 * stops it framing anything or being framed, `form-action 'none'` stops posts,
 * `worker-src 'none'` stops workers, and `base-uri 'none'` stops base-tag
 * retargeting. Images, media and fonts are the only remote loads left.
 *
 * What it does NOT do: it cannot block same-origin DOM or storage APIs, so a draft
 * can still read and write `localStorage`/`sessionStorage`/cookies for this origin,
 * and it does nothing at all for non-browser clients like curl -- the bytes are
 * served verbatim either way.
 *
 * This covers `/d/` only. The `/u/` and `/s/` pages are our own HTML, not uploaded
 * HTML, and they need cross-origin fetch, PUT and framing against S3, so they are
 * deliberately left out of it.
 */
const CSP = [
  "default-src 'none'",
  "img-src https: data:",
  "media-src https: data:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "worker-src 'none'",
].join("; ");

/** Headers for the uploaded HTML we serve from this origin: the sandbox above, plus no sniffing. */
const htmlSecurityHeaders = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

/** The published document. Serving it here keeps the URL stable across versions. */
async function serveDraft(ctx: any, request: Request, raw: boolean): Promise<Response> {
  const path = new URL(request.url).pathname;
  const id = decodeURIComponent(
    path.slice("/d/".length).replace(/\/raw$/, "").replace(/\/+$/, ""),
  );
  const found = await ctx.runQuery(internal.drafts.latest, { draftId: id });
  if (!found) {
    return new Response("<!doctype html><meta charset=utf-8><title>Not found</title>"
      + "<body style='background:#000;color:#888;font:16px system-ui;padding:48px'>No such draft.",
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8", ...htmlSecurityHeaders },
      });
  }
  const config = s3Config();
  const upstream = await fetch(await presign(config, "GET", found.version.key, 120));
  if (!upstream.ok) return new Response("Draft content missing", { status: 502 });
  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      "Content-Type": raw ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=30",
      "X-Postplan-Version": String(found.version.versionNumber),
      // /raw is plain text and is never rendered, so it needs nosniff but no CSP.
      ...(raw ? { "X-Content-Type-Options": "nosniff" } : htmlSecurityHeaders),
    },
  });
}

http.route({
  pathPrefix: "/d/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const raw = new URL(request.url).pathname.endsWith("/raw");
    return await serveDraft(ctx, request, raw);
  }),
});

export default http;
