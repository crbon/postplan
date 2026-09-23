import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const upsert = internalMutation({
  args: {
    draftId: v.string(),
    filename: v.string(),
    description: v.optional(v.string()),
    key: v.string(),
    sha256: v.optional(v.string()),
    bytes: v.number(),
    metadata: v.optional(v.any()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const metadata =
      typeof args.metadata === "object" && args.metadata !== null
        ? (args.metadata as Record<string, unknown>)
        : {};
    const repoName = typeof metadata.repoName === "string" ? metadata.repoName : null;
    const repoOrg = typeof metadata.repoOrg === "string" ? metadata.repoOrg : null;
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_draftId", (q) => q.eq("draftId", args.draftId))
      .unique();
    const versionNumber = existing ? existing.latestVersion + 1 : 1;

    if (existing) {
      await ctx.db.patch(existing._id, {
        filename: args.filename,
        description: args.description ?? existing.description,
        latestVersion: versionNumber,
        repoName,
        repoOrg,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("drafts", {
        draftId: args.draftId,
        filename: args.filename,
        description: args.description,
        latestVersion: versionNumber,
        repoName,
        repoOrg,
        createdBy: args.createdBy,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.insert("versions", {
      draftId: args.draftId,
      versionNumber,
      key: args.key,
      sha256: args.sha256,
      bytes: args.bytes,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
    return { versionNumber };
  },
});

/** The newest version of a draft -- what a public URL serves. */
export const latest = internalQuery({
  args: { draftId: v.string() },
  handler: async (ctx, args) => {
    // Same fallback as uploads: slug first, then the Convex document id.
    let draft = await ctx.db
      .query("drafts")
      .withIndex("by_draftId", (q) => q.eq("draftId", args.draftId))
      .unique();
    if (!draft) {
      const id = ctx.db.normalizeId("drafts", args.draftId);
      draft = id ? await ctx.db.get(id) : null;
    }
    if (!draft) return null;
    const version = await ctx.db
      .query("versions")
      .withIndex("by_draft_version", (q) =>
        q.eq("draftId", draft.draftId).eq("versionNumber", draft.latestVersion),
      )
      .unique();
    return version ? { draft, version } : null;
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(100);
    // Field names match what the upstream CLI renders, or `list` prints undefined.
    return await Promise.all(
      drafts.map(async (d) => {
        // Drafts created before repository fields were added still read their
        // latest version once. A later upload moves these values onto the draft.
        let repoName = d.repoName;
        let repoOrg = d.repoOrg;
        if (repoName === undefined && repoOrg === undefined) {
          const newest = await ctx.db
            .query("versions")
            .withIndex("by_draft_version", (q) =>
              q.eq("draftId", d.draftId).eq("versionNumber", d.latestVersion),
            )
            .unique();
          const meta = (newest?.metadata ?? {}) as Record<string, unknown>;
          repoName = typeof meta.repoName === "string" ? meta.repoName : undefined;
          repoOrg = typeof meta.repoOrg === "string" ? meta.repoOrg : undefined;
        }
        return {
          draftId: d.draftId,
          title: d.filename,
          description: d.description ?? null,
          publicUrl: `${process.env.POSTPLAN_PUBLIC_BASE_URL ?? ""}/d/${d.draftId}`,
          latestVersionNumber: d.latestVersion,
          versionCount: d.latestVersion,
          repoName: repoName ?? null,
          repoOrg: repoOrg ?? null,
          disabled: false,
          updatedAt: new Date(d.updatedAt).toISOString(),
        };
      }),
    );
  },
});
