import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

/**
 * Mirrors the download counter used by streamDownload.service:
 * HTTP 200 with 0 bytes must be treated as failure.
 */
test("compteur de stream : 0 octet = échec", async () => {
  let bytesSent = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytesSent += chunk.length;
      cb(null, chunk);
    },
  });
  const src = new PassThrough();
  const dst = new PassThrough();
  const done = pipeline(src, counter, dst);
  src.end(); // empty body
  await done;
  assert.equal(bytesSent, 0);
  assert.ok(bytesSent === 0, "EMPTY_DOWNLOAD_RESPONSE");
});

test("compteur de stream : octets réellement transmis", async () => {
  let bytesSent = 0;
  let first = false;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!first) first = true;
      bytesSent += chunk.length;
      cb(null, chunk);
    },
  });
  const src = new PassThrough();
  const chunks: Buffer[] = [];
  const dst = new PassThrough();
  dst.on("data", (c) => chunks.push(c));
  const done = pipeline(src, counter, dst);
  src.write(Buffer.from("hello "));
  src.write(Buffer.from("world"));
  src.end();
  await done;
  assert.equal(first, true);
  assert.equal(bytesSent, 11);
  assert.equal(Buffer.concat(chunks).toString(), "hello world");
});

test("contentDisposition ASCII + UTF-8 filename*", async () => {
  const { contentDisposition } = await import(
    "../backend/services/streamDownload.service.ts"
  );
  const h = contentDisposition('Vidéo test "clip".mp4');
  assert.match(h, /attachment;/);
  assert.match(h, /filename=/);
  assert.match(h, /filename\*=UTF-8''/);
  assert.ok(!h.includes('filename="Vidéo'));
});
