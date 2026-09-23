import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { presign, s3Config } from "../convex/lib/s3.ts";

test("R2 accepts signed PUT, GET and DELETE", async () => {
  const config = s3Config();
  const key = `${config.prefix}/test/${randomUUID()}.txt`;
  const contentType = "text/plain; charset=utf-8";
  const body = `R2 transfer test ${randomUUID()}`;
  try {
    const put = await fetch(await presign(config, "PUT", key, 60, contentType), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });
    assert.equal(put.status, 200, await put.text());

    const get = await fetch(await presign(config, "GET", key, 60));
    const downloaded = await get.text();
    assert.equal(get.status, 200, downloaded);
    assert.equal(downloaded, body);
  } finally {
    const removed = await fetch(await presign(config, "DELETE", key, 60), { method: "DELETE" });
    assert.ok(removed.ok, `R2 DELETE returned ${removed.status}: ${await removed.text()}`);
  }

  const missing = await fetch(await presign(config, "GET", key, 60));
  assert.equal(missing.status, 404);
});
