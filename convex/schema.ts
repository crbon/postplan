import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // A draft is a stable URL. Re-uploading the same file updates it in place and
  // adds a version, which is the whole point of the CLI's draftId round-trip.
  drafts: defineTable({
    draftId: v.string(),
    filename: v.string(),
    description: v.optional(v.string()),
    latestVersion: v.number(),
    // Missing means the draft predates these fields. Null means the latest
    // upload had no repository metadata.
    repoName: v.optional(v.union(v.string(), v.null())),
    repoOrg: v.optional(v.union(v.string(), v.null())),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_draftId", ["draftId"])
    .index("by_updatedAt", ["updatedAt"]),

  // An upload request: a link someone opens on a phone to send files in. The slug
  // is the credential, since whoever uploads may not be the person who made it.
  uploadRequests: defineTable({
    slug: v.string(),
    // "in" = someone sends files to Aryan; "out" = an agent sends files to him.
    // Optional so rows created before the outbound direction existed still load.
    direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
    reason: v.optional(v.string()),
    createdBy: v.string(),
    expiresAt: v.number(),
  }).index("by_slug", ["slug"]),

  uploadFiles: defineTable({
    slug: v.string(),
    key: v.string(),
    name: v.string(),
    size: v.number(),
    contentType: v.string(),
    uploadedAt: v.number(),
  }).index("by_slug", ["slug"]),

  versions: defineTable({
    draftId: v.string(),
    versionNumber: v.number(),
    key: v.string(),
    sha256: v.optional(v.string()),
    bytes: v.number(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_draft", ["draftId"])
    .index("by_draft_version", ["draftId", "versionNumber"]),
});
