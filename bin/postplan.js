#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { validateHtml } from "../src/html-policy.js";

// Single source of truth for the version: package.json. CI bumps it on every
// merge to main, so a hardcoded copy here would immediately drift.
const { version: VERSION } = createRequire(import.meta.url)("../package.json");
// This fork has its own CLI state and requires an explicit deployment URL.
const POSTPLAN_DIR = process.env.POSTPLAN_STATE_DIR || path.join(os.homedir(), ".postplan-r2");
const CONFIG_PATH = path.join(POSTPLAN_DIR, "config.json");
const CREDENTIALS_PATH = path.join(POSTPLAN_DIR, "credentials.json");
const DRAFTS_PATH = path.join(POSTPLAN_DIR, "drafts.json");

class CliError extends Error {}

const CONTENT_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", heic: "image/heic", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  pdf: "application/pdf", json: "application/json", zip: "application/zip",
  md: "text/markdown", txt: "text/plain", csv: "text/csv", log: "text/plain",
  html: "text/html", css: "text/css", js: "text/javascript", ts: "text/plain",
  py: "text/x-python", sh: "text/x-shellscript", yml: "text/yaml", yaml: "text/yaml"
};

function guessType(name) {
  const ext = name.toLowerCase().split(".").pop();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

const program = new Command();

program
  .name("postplan")
  .description("Upload static HTML drafts to a Convex and R2 Postplan instance.")
  .version(VERSION);

const authCommand = program.command("auth").description("Manage CLI authentication.");

authCommand
  .command("set")
  .argument("<api-key>", "Postplan API key")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .action((apiKey, options) => {
    const apiUrl = options.apiUrl || process.env.POSTPLAN_API_URL || readJson(CONFIG_PATH, {}).apiUrl;
    if (!apiUrl) throw new CliError("Missing API URL. Pass --api-url https://<deployment>.convex.site");
    saveCredentials(apiKey, apiUrl);
    console.log("Postplan credentials saved.");
  });

authCommand
  .command("login")
  .description("Log in by pasting an API key from the browser. Works over SSH.")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .action(async (options) => {
    const { apiUrl } = readAuth(options.apiUrl, { requireApiKey: false });

    console.log("Open this in your browser (any device):\n");
    console.log(`  ${apiUrl}/cli/auth\n`);
    console.log("Sign in, generate a key, then paste it below.\n");

    const readline = await import("node:readline/promises");
    const { once } = await import("node:events");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let apiKey;
    try {
      // rl.question never resolves if stdin closes (EOF/ctrl-d) — race the
      // close event so that path hits the "No key entered" error below
      // instead of exiting 0 silently.
      apiKey = (
        await Promise.race([
          rl.question("Paste your API key: "),
          once(rl, "close").then(() => "")
        ])
      ).trim();
    } finally {
      rl.close();
    }

    if (!apiKey) {
      throw new CliError("No key entered. Nothing saved.");
    }

    const response = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new CliError(body.error || "That key was rejected. Nothing saved.");
    }

    saveCredentials(apiKey, apiUrl);
    console.log(`\nLogged in as ${body.accountName} (key: ${body.apiKeyName}).`);
  });

program
  .command("whoami")
  .description("Check the configured Postplan credentials.")
  .action(async () => {
    const { apiUrl, apiKey } = readAuth();
    const response = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new CliError(body.error || "Authentication failed.");
    }
    console.log(`Account: ${body.accountName} (${body.accountId})`);
    console.log(`API key: ${body.apiKeyName} (${body.apiKeyId})`);
  });

program
  .command("upload")
  .argument("<file>", "HTML file path")
  .option("--draft <draft-id>", "Update a specific draft")
  .option("--new", "Always create a new draft")
  .option("--description <text>", "Set a short description for the draft")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .description("Upload or update an HTML draft.")
  .action(async (file, options) => {
    const resolvedFile = path.resolve(file);
    const { apiUrl, apiKey } = readAuth(options.apiUrl);

    if (!fs.existsSync(resolvedFile)) {
      throw new CliError(`File does not exist: ${resolvedFile}`);
    }

    const html = fs.readFileSync(resolvedFile, "utf8");
    const validation = validateHtml(html);

    if (!validation.ok) {
      throw new CliError(`HTML failed Postplan validation:\n- ${validation.errors.join("\n- ")}`);
    }

    const drafts = readDrafts();
    const knownDraft = drafts.files?.[resolvedFile];
    const draftId = options.new ? null : options.draft || knownDraft?.draftId || null;

    const payload = {
      html,
      filename: path.basename(resolvedFile),
      draftId,
      description: options.description,
      metadata: {
        ...collectGitMetadata(path.dirname(resolvedFile)),
        ...collectCiMetadata(),
        cliVersion: VERSION,
        fileSha256: sha256(html)
      }
    };

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": `postplan/${VERSION}`
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${apiUrl}/api/uploads`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok) {
      const details = body.errors?.length ? `\n- ${body.errors.join("\n- ")}` : "";
      throw new CliError(`${body.error || "Upload failed."}${details}`);
    }

    drafts.files ||= {};
    drafts.files[resolvedFile] = {
      draftId: body.draftId,
      publicUrl: body.publicUrl,
      rawUrl: body.rawUrl || `${body.publicUrl.replace(/\/+$/, "")}/raw`,
      latestVersionNumber: body.versionNumber,
      updatedAt: new Date().toISOString()
    };
    writeJson(DRAFTS_PATH, drafts, 0o600);

    console.log(draftId ? "Updated draft" : "Uploaded draft");
    console.log(`URL: ${body.publicUrl}`);
    console.log(`Raw HTML: ${body.rawUrl || `${body.publicUrl.replace(/\/+$/, "")}/raw`}`);
    console.log(`Draft ID: ${body.draftId}`);
    console.log(`Version: ${body.versionNumber}`);
    for (const warning of body.warnings || []) {
      console.warn(`Warning: ${warning}`);
    }
  });

program
  .command("generate-upload-link")
  // 0.2.0 shipped this as `generate-link`; keep it working for anything cached.
  .alias("generate-link")
  .description("Create a link someone can open on a phone to send files in.")
  .argument("[reason]", "why the link exists, shown on the page")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--days <n>", "How long the link stays open (default 7)", (v) => Number(v))
  .action(async (reason, options) => {
      const { apiUrl, apiKey } = readAuth(options.apiUrl);
      const response = await fetch(`${apiUrl}/api/upload-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ reason: reason || undefined, days: options.days })
      });
      const body = await response.json();
      if (!response.ok) throw new CliError(body.error || "Could not create the link.");
      console.log(body.url);
  });

program
  .command("send")
  .description("Send files to Aryan: returns a link he can preview or download on his phone.")
  .argument("<files...>", "files to send")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--reason <text>", "what these files are, shown on the page")
  .option("--days <n>", "How long the link stays open (default 7)", (v) => Number(v))
  .action(async (files, options) => {
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const resolved = files.map((f) => path.resolve(f));
    for (const file of resolved) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new CliError(`Not a file: ${file}`);
      }
    }

    const created = await fetch(`${apiUrl}/api/upload-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        reason: options.reason || path.basename(resolved[0]),
        days: options.days,
        direction: "out"
      })
    });
    const info = await created.json();
    if (!created.ok) throw new CliError(info.error || "Could not create the link.");

    for (const file of resolved) {
      const name = path.basename(file);
      const type = guessType(name);
      const signed = await fetch(`${apiUrl}/api/u/${info.slug}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contentType: type })
      });
      const slot = await signed.json();
      if (!signed.ok) throw new CliError(slot.error || `Could not prepare ${name}.`);
      const put = await fetch(slot.url, {
        method: "PUT",
        headers: { "Content-Type": type },
        body: fs.readFileSync(file)
      });
      if (!put.ok) throw new CliError(`Upload failed for ${name} (${put.status})`);
      const recorded = await fetch(`${apiUrl}/api/u/${info.slug}/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: slot.key, name, size: fs.statSync(file).size, contentType: type })
      });
      if (!recorded.ok) throw new CliError(`Could not record ${name}.`);
    }
    console.log(info.url);
  });

program
  .command("fetch")
  .description("Download what was sent to an upload link.")
  .argument("<slug>", "the upload link's slug")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--output <dir>", "Where to write the files")
  .action(async (slug, options) => {
      const { apiUrl, apiKey } = readAuth(options.apiUrl);
      const response = await fetch(`${apiUrl}/api/upload-requests/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ slug })
      });
      const body = await response.json();
      if (!response.ok) throw new CliError(body.error || "Could not read that link.");
      if (!body.files.length) {
        console.log("Nothing has been sent to this link yet.");
        return;
      }
      const dir = options.output || path.join(os.homedir(), "Downloads", `upload-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of body.files) {
        const safe = path.basename(file.name).replace(/[/\\]/g, "_") || "file";
        const destination = path.join(dir, safe);
        const data = await fetch(file.url);
        if (!data.ok) throw new CliError(`Could not download ${file.name} (${data.status})`);
        fs.writeFileSync(destination, Buffer.from(await data.arrayBuffer()));
        console.log(destination);
      }
      console.log(`Downloaded ${body.files.length} file(s) to ${dir}`);
  });

program
  .command("list")
  .description("List the drafts published to your account.")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .option("--json", "Print the raw JSON response")
  .action(async (options) => {
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const response = await fetch(`${apiUrl}/api/drafts`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new CliError(body.error || "Failed to list drafts.");
    }

    const drafts = body.drafts || [];

    if (options.json) {
      console.log(JSON.stringify(drafts, null, 2));
      return;
    }

    if (!drafts.length) {
      console.log("No drafts yet. Publish one with: postplan upload <file>");
      return;
    }

    console.log(`Drafts (${drafts.length})\n`);
    for (const draft of drafts) {
      const repo = draft.repoOrg && draft.repoName ? `${draft.repoOrg}/${draft.repoName}` : "no repo";
      const version = draft.latestVersionNumber ? `v${draft.latestVersionNumber}` : "no versions";
      const count = `${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"}`;
      const disabled = draft.disabled ? " · disabled" : "";

      console.log(draft.title || "Untitled Draft");
      console.log(`  ${repo} · ${version} · ${count} · updated ${timeAgo(draft.updatedAt)}${disabled}`);
      console.log(`  ${draft.publicUrl}`);
      if (draft.description) {
        console.log(`  ${draft.description}`);
      }
      console.log("");
    }
  });

program.exitOverride();

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(1);
  }

  if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
    process.exit(0);
  }

  console.error(error.message || error);
  process.exit(1);
});

function readAuth(apiUrlOverride, { requireApiKey = true } = {}) {
  const config = readJson(CONFIG_PATH, {});
  const credentials = readJson(CREDENTIALS_PATH, {});
  const apiUrl = (
    apiUrlOverride ||
    process.env.POSTPLAN_API_URL ||
    config.apiUrl
  );
  if (!apiUrl) throw new CliError("Missing API URL. Run: postplan auth set <api-key> --api-url <url>");
  const normalizedApiUrl = apiUrl.replace(/\/+$/, "");
  const apiKey = process.env.POSTPLAN_API_KEY || credentials.apiKey;

  if (requireApiKey && !apiKey) {
    throw new CliError("Missing API key. Run: postplan auth set <api-key> --api-url <url>");
  }

  return { apiUrl: normalizedApiUrl, apiKey };
}

function ensureStateDir() {
  fs.mkdirSync(POSTPLAN_DIR, { recursive: true, mode: 0o700 });
}

function saveCredentials(apiKey, apiUrlOverride) {
  ensureStateDir();

  if (apiUrlOverride) {
    writeJson(CONFIG_PATH, {
      ...readJson(CONFIG_PATH, {}),
      apiUrl: apiUrlOverride.replace(/\/+$/, "")
    });
  }

  writeJson(
    CREDENTIALS_PATH,
    {
      apiKey,
      updatedAt: new Date().toISOString()
    },
    0o600
  );
}

function readDrafts() {
  return readJson(DRAFTS_PATH, { files: {} });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, mode = 0o600) {
  ensureStateDir();
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(file, mode);
}

function collectGitMetadata(cwd) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const parsedRemote = parseRemote(remote);
  const status = git(["status", "--porcelain"], cwd);

  return {
    repoOrg: parsedRemote.org || inferOrgFromRoot(repoRoot),
    repoName: parsedRemote.name || (repoRoot ? path.basename(repoRoot) : null),
    repoHost: parsedRemote.host || null,
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitCommitSha: git(["rev-parse", "HEAD"], cwd),
    gitCommitSubject: git(["log", "-1", "--format=%s"], cwd),
    // null when not a git repo; true/false when a working tree is present.
    gitDirty: status === null ? null : status.length > 0
  };
}

// Best-effort CI provenance. GitHub Actions is detected precisely (with a run
// URL); other CI systems are flagged generically. Nothing here is trusted for
// authorization — it is metadata for the dashboard and audit trail only.
function collectCiMetadata() {
  const env = process.env;
  if (env.GITHUB_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      ciProvider: "github_actions",
      ciRunUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
      ciActor: env.GITHUB_ACTOR || null
    };
  }
  if (env.CI) {
    return { ciProvider: "unknown" };
  }
  return {};
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function parseRemote(remote) {
  if (!remote) return {};

  const cleaned = remote.replace(/\.git$/, "");
  const sshMatch = cleaned.match(/^[^@]+@([^:]+):([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { host: sshMatch[1], org: sshMatch[2], name: path.basename(sshMatch[3]) };
  }

  try {
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { host: url.hostname, org: parts[0], name: parts.at(-1) };
    }
  } catch {
    // Fall through to path parsing.
  }

  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { org: parts.at(-2), name: parts.at(-1) };
  }

  return {};
}

function inferOrgFromRoot(repoRoot) {
  if (!repoRoot) return null;
  return path.basename(path.dirname(repoRoot));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function timeAgo(value) {
  if (!value) return "unknown";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [name, secs] of units) {
    const amount = Math.floor(seconds / secs);
    if (amount >= 1) return `${amount} ${name}${amount === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
