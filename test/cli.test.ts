import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);

test("fork CLI requires an explicit deployment URL and API key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "postplan-r2-cli-"));
  const file = join(directory, "draft.html");
  await writeFile(file, "<!doctype html><title>Test</title><p>Safe document</p>");
  const env = { ...process.env, POSTPLAN_STATE_DIR: directory };
  delete env.POSTPLAN_API_URL;
  try {
    await assert.rejects(
      run(process.execPath, [resolve("bin/postplan.js"), "upload", file], { env }),
      (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? "", /Missing API URL/);
        return true;
      },
    );
    env.POSTPLAN_API_URL = "https://example.convex.site";
    delete env.POSTPLAN_API_KEY;
    await assert.rejects(
      run(process.execPath, [resolve("bin/postplan.js"), "upload", file], { env }),
      (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? "", /Missing API key/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
