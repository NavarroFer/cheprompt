import assert from "node:assert/strict";
import test from "node:test";
import { decodeAttachments, isPromptAttachmentList, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "../attachments";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (extra = 4) => ({ name: "captura.png", mimeType: "image/png", data: Buffer.concat([PNG_HEADER, Buffer.alloc(extra)]).toString("base64") });

test("decodes supported pasted images and keeps their bytes", () => {
  const [decoded] = decodeAttachments([png()]);
  assert.equal(decoded.extension, "png");
  assert.ok(decoded.bytes.subarray(0, 8).equals(PNG_HEADER));
  const jpeg = { name: "foto.jpg", mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64") };
  assert.equal(decodeAttachments([jpeg])[0].extension, "jpg");
});

test("rejects unsupported, disguised, malformed, oversized or too many attachments", () => {
  assert.throws(() => decodeAttachments([{ name: "a.svg", mimeType: "image/svg+xml", data: "PHN2Zz4=" }]), /PNG, JPEG, GIF o WebP/);
  assert.throws(() => decodeAttachments([{ ...png(), mimeType: "image/gif" }]), /no coincide/);
  assert.throws(() => decodeAttachments([{ ...png(), data: "no es base64!" }]), /No se pudo leer/);
  assert.throws(() => decodeAttachments([png(MAX_ATTACHMENT_BYTES)]), /5 MB/);
  assert.throws(() => decodeAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => png())), /hasta 4 imágenes/);
});

test("validates the attachment message shape", () => {
  assert.equal(isPromptAttachmentList([png()]), true);
  assert.equal(isPromptAttachmentList([]), true);
  assert.equal(isPromptAttachmentList([{ name: "a.png", mimeType: "image/png" }]), false);
  assert.equal(isPromptAttachmentList("a.png"), false);
});
