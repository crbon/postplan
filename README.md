# Postplan

This Postplan fork builds on [upstream Postplan Convex](https://github.com/Aryan-Saini/postplan-convex). Convex serves the API and document pages and stores metadata. Private Cloudflare R2 stores document HTML and uploaded files. The fork keeps the existing upload API, CLI behavior, and draft URLs.

## Set up on a new machine

This fork needs its own Convex project and private R2 bucket. Do not connect it to the source Postplan project. Existing S3 objects do not move to R2 automatically.

### Create the cloud resources

1. In Cloudflare, create a private R2 bucket and an API token with **Object Read & Write** permission limited to that bucket. Save the Access Key ID and Secret Access Key. Copy the account S3 endpoint, which looks like `https://<account-id>.r2.cloudflarestorage.com`. Leave public access disabled. Follow Cloudflare's [R2 S3 setup guide](https://developers.cloudflare.com/r2/get-started/s3/).
2. In Convex, create a separate project for this fork. Keep its production deployment URL and the name of one of its development deployments handy. A Convex project has separate development and production deployments. This fork stores server settings on production only.

### Clone and select the Convex project

On the new machine, install Node.js 20 or newer and pnpm. Clone this repository, then install its dependencies:

```bash
git clone https://github.com/crbon/postplan.git
cd postplan
pnpm install
```

Log in to Convex, then select a development deployment belonging to the new R2 project:

```bash
pnpm exec convex login
pnpm exec convex deployment select <r2-project-dev-deployment>
```

The CLI writes `.env.local` for this checkout. Do not create it by copying `.env.example` or by typing a `CONVEX_DEPLOYMENT` value yourself. Check the selection output. It must name the new R2 project. If it shows another project, stop and select the right deployment before setting environment variables. The selected development deployment identifies the project; the server settings below go to that project's production deployment. See Convex's [deployment selection guide](https://docs.convex.dev/cli/reference/deployment).

Open the production deployment dashboard to confirm its project before making changes:

```bash
pnpm exec convex dashboard --prod
```

### Set production environment variables

Replace the example values before running these commands. Do not type the angle brackets. Use the production `.convex.site` URL for both `POSTPLAN_PUBLIC_BASE_URL` and the CLI API URL. Pick a stable `S3_PREFIX`, such as `postplan`, and keep it unchanged so existing object keys and draft links continue to work.

```bash
pnpm exec convex env set --prod S3_BUCKET <r2-bucket-name>
pnpm exec convex env set --prod S3_REGION auto
pnpm exec convex env set --prod S3_PREFIX <stable-prefix>
pnpm exec convex env set --prod S3_ENDPOINT https://<account-id>.r2.cloudflarestorage.com
pnpm exec convex env set --prod POSTPLAN_PUBLIC_BASE_URL https://<r2-prod-deployment>.convex.site
```

Set the credentials and API key interactively so they do not appear in shell history or command arguments:

```bash
pnpm exec convex env set --prod S3_ACCESS_KEY_ID
pnpm exec convex env set --prod S3_SECRET_ACCESS_KEY
pnpm exec convex env set --prod POSTPLAN_API_KEY
```

Use the R2 token credentials for the first two prompts. Generate a long random API key with `openssl rand -hex 32`, save it in a password manager, then enter it at the third prompt. You will need it for the CLI. Owner endpoints reject requests while the API key is unset. Do not put these values in tracked files. See Convex's [environment variable guide](https://docs.convex.dev/cli/reference/env).

Check that all eight variable names are present. This prints names only, not values:

```bash
pnpm exec convex env --prod list --names-only
```

### Configure R2 CORS

In Cloudflare, open the bucket's **Settings → CORS Policy** and add the rule below. Replace the origin with the exact production `.convex.site` origin or custom domain that serves `/u/...`. Keep R2 public access disabled.

```json
[
  {
    "AllowedOrigins": ["https://<r2-prod-deployment>.convex.site"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

The `/u/...` page sends browser uploads directly to R2 with a presigned `PUT`. Its `Content-Type` must match the signed value. CLI document uploads and `/d/...` reads pass through Convex and do not need browser CORS access. See Cloudflare's [CORS guide](https://developers.cloudflare.com/r2/buckets/cors/).

### Test and deploy

Run the local tests:

```bash
pnpm test
```

The R2 integration test needs all six `S3_*` variables in your local shell. For zsh, enter credentials without echoing them, run the test, then clear them from the shell:

```zsh
export S3_BUCKET=<r2-bucket-name> S3_REGION=auto S3_PREFIX=<stable-prefix>
read -s 'S3_ENDPOINT?R2 endpoint: '; print
export S3_ENDPOINT
read -s 'S3_ACCESS_KEY_ID?R2 Access Key ID: '; print
export S3_ACCESS_KEY_ID
read -s 'S3_SECRET_ACCESS_KEY?R2 Secret Access Key: '; print
export S3_SECRET_ACCESS_KEY

pnpm test:r2

unset S3_BUCKET S3_REGION S3_PREFIX S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
```

The test uploads, downloads, and deletes its own temporary object. Deploy only after the environment and transfer test are ready. `pnpm exec convex deploy` deploys to production for the project selected above. Read the confirmation prompt before accepting. See Convex's [deploy command guide](https://docs.convex.dev/cli/reference/deploy):

```bash
pnpm exec convex deploy
```

Then test the deployed API and browser upload flow. This test creates a draft, an upload request, and a test file in R2, and leaves them in place:

```zsh
export POSTPLAN_API_URL=https://<r2-prod-deployment>.convex.site
read -s 'POSTPLAN_API_KEY?Production API key: '; print
export POSTPLAN_API_KEY

pnpm test:e2e

unset POSTPLAN_API_URL POSTPLAN_API_KEY
```

The test checks CLI upload and re-upload, document viewing, upload-link creation, browser upload signing, and the R2 CORS preflight.

### Use the `postplan` command

Link this checkout so your shell can run the `postplan` command:

```bash
pnpm link --global
postplan --help
```

Save the production API key in the CLI configuration under `~/.postplan`. In zsh:

```zsh
read -s 'POSTPLAN_API_KEY?Production API key: '; print
postplan auth set "$POSTPLAN_API_KEY" --api-url https://<r2-prod-deployment>.convex.site
unset POSTPLAN_API_KEY
```

Upload an HTML document:

```bash
postplan upload plan.html
```

Open the returned `/d/<draftId>` URL. Edit `plan.html` and upload it again. The URL should stay the same and `X-Postplan-Version` should increase. To receive files through a browser upload page, run `postplan generate-upload-link`, open its `/u/...` link, and check the file list.

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

The CLI reads `--api-url`, then `POSTPLAN_API_URL`, then `~/.postplan/config.json`. It requires an explicit URL. Install or link this fork to expose the `postplan` command. The original [`postplan` npm package](https://www.npmjs.com/package/postplan) is MIT licensed.
