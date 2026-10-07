// Armazenamento de ficheiros enviados (BI, cartas, comprovativos, fotos) — partilhado pelo PWA e pela API v1.
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const uploadsDir = process.env.UPLOADS_DIR ? resolve(process.env.UPLOADS_DIR) : join(rootDir, "uploads");

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Tipos aceites e a extensão com que ficam guardados (nunca a do nome original). */
export const allowedUploads = new Map<string, string>([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
]);

/** Confirma pelos primeiros bytes que o ficheiro é mesmo do tipo declarado pelo cliente. */
export async function hasExpectedSignature(path: string, mimeType: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    if (bytesRead < 4) return false;
    const ascii = (start: number, end: number) => buffer.subarray(start, end).toString("latin1");
    switch (mimeType) {
      case "application/pdf":
        return ascii(0, 4) === "%PDF";
      case "image/jpeg":
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      case "image/png":
        return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      case "image/webp":
        return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
      case "image/heic":
      case "image/heif":
        return ascii(4, 8) === "ftyp";
      default:
        return false;
    }
  } finally {
    await handle.close();
  }
}
