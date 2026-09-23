# postplan-convex-r2

This is a local fork of [postplan-convex](https://github.com/Aryan-Saini/postplan-convex). It stores document HTML and file uploads in a private Cloudflare R2 bucket while Convex holds metadata and serves the API and document pages. The CLI keeps the same upload API and draft URLs.

## Set up a separate production instance

Use a new Convex project and a new R2 bucket. This keeps the source project's documents and links on its existing deployment. Existing S3 objects do not move automatically.

1. Create a private R2 bucket. Create an R2 API token with **Object Read & Write** access limited to that bucket. Save its Access Key ID, Secret Access Key, and the account endpoint shown by Cloudflare. The endpoint has the form `https://<account-id>.r2.cloudflarestorage.com`. Do not enable public bucket access. Cloudflare's [S3 setup guide](https://developers.cloudflare.com/r2/get-started/s3/) has the current dashboard steps.
2. Create a separate Convex project and copy `.env.example` to `.env.local`. Fill in that project's production deployment name and URLs. Use the `.convex.site` URL for the API and public document links. Do not run `convex dev` for this production-only fork.
3. Install dependencies with `pnpm install`, then set the server variables on the new Convex production deployment:

   ```bash
   pnpm exec convex env set --prod S3_BUCKET <new-r2-bucket>
   pnpm exec convex env set --prod S3_REGION auto
   pnpm exec convex env set --prod S3_ENDPOINT https://<account-id>.r2.cloudflarestorage.com
   pnpm exec convex env set --prod S3_PREFIX <private-prefix>
   pnpm exec convex env set --prod S3_ACCESS_KEY_ID <r2-access-key-id>
   pnpm exec convex env set --prod S3_SECRET_ACCESS_KEY <r2-secret-access-key>
   pnpm exec convex env set --prod POSTPLAN_PUBLIC_BASE_URL https://<new-deployment>.convex.site
   pnpm exec convex env set --prod POSTPLAN_API_KEY <long-random-key>
   ```

   `POSTPLAN_API_KEY` protects draft uploads. Owner endpoints reject requests while it is unset. Keep all secrets in Convex environment variables, never in this repository.

4. Add this CORS policy to the R2 bucket, replacing the origin with the exact Convex site origin or the exact custom domain that serves `/u/...`:

   ```json
   [
     {
       "AllowedOrigins": ["https://<new-deployment>.convex.site"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   The `/u/...` page uploads directly to R2 with a presigned `PUT`. Its `Content-Type` must match the signed value. CLI document uploads and `/d/...` reads pass through Convex, so they do not need browser CORS access. See Cloudflare's [CORS guide](https://developers.cloudflare.com/r2/buckets/cors/).

5. Run `pnpm test`. Export the six `S3_*` values above in your local shell, then run `pnpm test:r2` to exercise signed `PUT`, `GET`, and `DELETE` against the new bucket. The integration test deletes its own test object.
6. Deploy with `pnpm exec convex deploy` once the environment and R2 transfer test are ready. Export `POSTPLAN_API_URL` and `POSTPLAN_API_KEY` for the new deployment, then run `pnpm test:e2e`. It tests CLI upload and re-upload, document viewing, browser upload signing, and the R2 CORS preflight. It leaves one test draft and one upload request in Convex.

   You can also configure the CLI for normal use:

   ```bash
   postplan auth set <postplan-api-key> --api-url https://<new-deployment>.convex.site
   postplan upload plan.html
   ```

   Open the returned `/d/<draftId>` URL, then edit `plan.html` and upload it again. The URL should stay the same and `X-Postplan-Version` should increase. Also generate an upload link with `postplan generate-upload-link`, upload a file from `/u/...`, and verify it appears in the link's file list.

## Draft dashboard

Open `https://<new-deployment>.convex.site/dashboard` and enter the deployment's `POSTPLAN_API_KEY`. The page lists the 100 most recently updated drafts and supports search and repository filtering. The key stays in the browser tab's session storage and the dashboard sends it only to the same-origin `/api/drafts` endpoint.

## Content-Security-Policy

`GET /d/<draftId>` sets:

```
default-src 'none'; img-src https: data:; media-src https: data:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'
```

plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The
not-found page carries the same headers. `/d/<draftId>/raw` is `text/plain` with
`nosniff` and no CSP, because it is never rendered.

What it guarantees, in a browser: the upload policy allows inline classic
`<script>`, so a draft's own scripts still run, but they cannot fetch
(`connect-src 'none'`), frame anything or be framed, submit a form, start a
worker, retarget relative URLs with a base tag, or load a remote script,
stylesheet or font. Images and media may load over https or as data URIs.

What it does not guarantee: it cannot block same-origin storage, so a draft can
read and write `localStorage`, `sessionStorage` and cookies for your deployment
origin alongside every other draft you host there. It also does nothing for
non-browser clients; `curl` gets the bytes verbatim. Treat the upload policy in
`src/html-policy.js`, not the CSP, as the real gate.

The upload and download pages (`/u/<slug>`, `/s/<slug>`) are the server's own
HTML rather than uploaded HTML, and they need cross-origin fetch, PUT and framing
against S3, so they are not covered by this policy.

## Rendering Markdown

Being added.

The dashboard is read only. Opening a draft uses its existing public `/d/<draftId>` URL, which remains accessible to anyone who has the link.

## Storage and URLs

Draft versions remain under `<prefix>/<draftId>/<sha256>.html`. Re-uploading the same file path updates the draft's stable `/d/<draftId>` URL. The R2 bucket stays private; Convex fetches draft HTML with short-lived signed URLs. The presigner uses the R2 account host, puts the bucket in the URL path, and signs with region `auto`.

The CLI reads `--api-url`, then `POSTPLAN_API_URL`, then `~/.postplan-r2/config.json`. It requires an explicit URL and keeps its credentials and draft mapping separate from the source CLI. Install or link this fork to expose the `postplan` command. The original [postplan](https://www.npmjs.com/package/postplan) project is MIT licensed.
