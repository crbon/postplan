import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateHtml } from "../src/html-policy.js";
import { draftKey, presign, s3Config } from "./lib/s3";
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

/** The page itself. */
http.route({
  pathPrefix: "/u/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/u/".length).replace(/\/+$/, ""));
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    const page = (body: string, status: number) =>
      new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (!found) {
      return page("<!doctype html><meta charset=utf-8><title>Not found</title><body style='background:#000;color:#71717a;font:16px system-ui;padding:48px'>That link is not valid any more.", 404);
    }
    if (found.request.expiresAt < Date.now()) {
      return page("<!doctype html><meta charset=utf-8><title>Expired</title><body style='background:#000;color:#71717a;font:16px system-ui;padding:48px'>This upload link has expired.", 410);
    }
    return page(uploadPage(slug, found.request.reason, found.files), 200);
  }),
});

/** Files an agent sent to Aryan: previewable on a phone, downloadable to keep. */
http.route({
  pathPrefix: "/s/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/s/".length).replace(/\/+$/, ""));
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    const page = (body: string, status: number) =>
      new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (!found) {
      return page("<!doctype html><meta charset=utf-8><title>Not found</title><body style='background:#000;color:#71717a;font:16px system-ui;padding:48px'>That link is not valid any more.", 404);
    }
    if (found.request.expiresAt < Date.now()) {
      return page("<!doctype html><meta charset=utf-8><title>Expired</title><body style='background:#000;color:#71717a;font:16px system-ui;padding:48px'>This link has expired.", 410);
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
    return page(downloadPage(slug, found.request.reason, files), 200);
  }),
});

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
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
