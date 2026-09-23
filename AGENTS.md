# Postplan

This Postplan fork uses Convex for its API and metadata and a private Cloudflare R2 bucket for document and upload files. Keep deployment names, bucket names, prefixes, account IDs, API keys, and secrets out of tracked files. Use `.env.local` for the Convex deployment and Convex production environment variables for server settings.

Read `README.md` when changing deployment or storage setup. Run `pnpm test` for signer changes and `pnpm test:r2` with credentials for real R2 transfers. Deploy only to this fork's production deployment with `pnpm exec convex deploy`; `convex dev` would create an unintended dev deployment.

The CLI API shapes in `convex/http.ts` must remain compatible with `bin/postplan.js`. The fork's CLI state lives in `~/.postplan-r2`. Draft IDs and the `<prefix>/<draftId>/<sha256>.html` key format must remain stable so re-uploads preserve document links.

When editing Convex code, read `convex/_generated/ai/guidelines.md` if Convex has generated it. If it is absent, use the current Convex documentation and existing project patterns.
