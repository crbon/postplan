import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);

test("CLI re-upload and browser upload work on the deployed Convex and R2 instance", async () => {
  const apiUrl = process.env.POSTPLAN_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.POSTPLAN_API_KEY;
  assert.ok(apiUrl && apiKey, "Set POSTPLAN_API_URL and POSTPLAN_API_KEY for the fork deployment");
  const origin = new URL(apiUrl).origin;
  const directory = await mkdtemp(join(tmpdir(), "postplan-r2-e2e-"));
  const htmlFile = join(directory, "smoke.html");
  const cli = resolve("bin/postplan.js");
  const cliEnv = { ...process.env, POSTPLAN_API_URL: apiUrl, POSTPLAN_API_KEY: apiKey, POSTPLAN_STATE_DIR: directory };
  const marker = randomUUID();

  try {
    await writeFile(htmlFile, `<!doctype html><title>R2 test</title><p>First ${marker}</p>`);
    const first = await run(process.execPath, [cli, "upload", htmlFile], { env: cliEnv });
    const publicUrl = first.stdout.match(/^URL: (.+)$/m)?.[1];
    assert.ok(publicUrl, first.stdout);
    assert.equal(new URL(publicUrl).origin, origin);
    const firstView = await fetch(publicUrl);
    assert.equal(firstView.status, 200);
    assert.match(await firstView.text(), new RegExp(`First ${marker}`));
    assert.equal(firstView.headers.get("X-Postplan-Version"), "1");

    await writeFile(htmlFile, `<!doctype html><title>R2 test</title><p>Second ${marker}</p>`);
    const second = await run(process.execPath, [cli, "upload", htmlFile], { env: cliEnv });
    assert.equal(second.stdout.match(/^URL: (.+)$/m)?.[1], publicUrl);
    const secondView = await fetch(publicUrl);
    assert.equal(secondView.status, 200);
    assert.match(await secondView.text(), new RegExp(`Second ${marker}`));
    assert.equal(secondView.headers.get("X-Postplan-Version"), "2");

    const created = await fetch(`${apiUrl}/api/upload-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ reason: `R2 test ${marker}`, days: 1 }),
    });
    if (!created.ok) assert.fail(`Creating upload link failed (${created.status}): ${await created.text()}`);
    const { slug, url: uploadPageUrl } = await created.json() as { slug: string; url: string };
    const page = await fetch(uploadPageUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Choose files/);

    const name = `r2-test-${marker}.txt`;
    const contentType = "text/plain";
    const body = `Uploaded from browser flow ${marker}`;
    const signed = await fetch(`${apiUrl}/api/u/${slug}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contentType }),
    });
    if (!signed.ok) assert.fail(`Signing upload failed (${signed.status}): ${await signed.text()}`);
    const slot = await signed.json() as { key: string; url: string };

    const preflight = await fetch(slot.url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.ok(preflight.ok, `R2 preflight returned ${preflight.status}`);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);

    const put = await fetch(slot.url, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": contentType },
      body,
    });
    assert.equal(put.status, 200, await put.text());
    const recorded = await fetch(`${apiUrl}/api/u/${slug}/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: slot.key, name, size: Buffer.byteLength(body), contentType }),
    });
    assert.equal(recorded.status, 200, await recorded.text());
    const updatedPage = await fetch(uploadPageUrl);
    assert.match(await updatedPage.text(), new RegExp(name));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
