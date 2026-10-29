export interface PromptAttachment {
  name: string;
  mimeType: string;
  /** Base64 file contents without a data-URL prefix. */
  data: string;
}

export interface DecodedAttachment {
  extension: string;
  bytes: Buffer;
}

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function isPromptAttachmentList(value: unknown): value is PromptAttachment[] {
  return Array.isArray(value) && value.every((attachment) => (
    !!attachment
    && typeof attachment === "object"
    && typeof attachment.name === "string"
    && typeof attachment.mimeType === "string"
    && typeof attachment.data === "string"
  ));
}

export function decodeAttachments(attachments: readonly PromptAttachment[]): DecodedAttachment[] {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`Podés adjuntar hasta ${MAX_ATTACHMENTS} imágenes por mensaje.`);
  }
  return attachments.map((attachment) => {
    const extension = IMAGE_EXTENSIONS[attachment.mimeType];
    if (!extension) throw new Error("Solo se pueden adjuntar imágenes PNG, JPEG, GIF o WebP.");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.data)) throw new Error("No se pudo leer una de las imágenes adjuntas.");
    const bytes = Buffer.from(attachment.data, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("Cada imagen puede pesar hasta 5 MB.");
    // The runtimes receive these files directly, so the contents must match the declared image type.
    if (!hasImageSignature(bytes, attachment.mimeType)) {
      throw new Error("Una de las imágenes adjuntas no coincide con su formato.");
    }
    return { extension, bytes };
  });
}

function hasImageSignature(bytes: Buffer, mimeType: string): boolean {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString("latin1");
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
  if (mimeType === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  return false;
}
