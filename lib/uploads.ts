import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local file storage for development.
 *
 * Everything here is written defensively, because upload handling is where
 * this kind of app usually goes wrong:
 *
 *   - The stored name is server-generated. The original filename is display
 *     data only and never touches a path, so "../../.env" is just a label.
 *   - Reads resolve the path and verify it is still inside the upload
 *     directory before opening anything.
 *   - Only an allowlist of types is accepted, and everything is served back
 *     with a fixed content type plus nosniff, so an uploaded .svg or .html
 *     can't execute in the app's origin.
 *
 * Swapping this for S3 or Vercel Blob later means replacing `save` and `read`.
 *
 * Marked server-only: importing it from a client component would drag node:fs
 * into the browser bundle, which is exactly how this broke the first time.
 * Display helpers like formatBytes live in lib/utils.ts instead.
 */

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** 10 MB — comfortably more than a design comp, far less than a video. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Accepted types, mapped to the extension used on disk. SVG is deliberately
 * absent: it is script-capable, and nothing here needs it.
 */
export const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export function isAllowedType(mimeType: string): boolean {
  return Object.hasOwn(ALLOWED_TYPES, mimeType);
}

export function extensionFor(mimeType: string): string {
  return ALLOWED_TYPES[mimeType] ?? "bin";
}

/** Writes the bytes under a generated name and returns that name. */
export async function save(
  id: string,
  mimeType: string,
  bytes: Buffer,
): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const storedName = `${id}.${extensionFor(mimeType)}`;
  await writeFile(path.join(UPLOAD_DIR, storedName), bytes);

  return storedName;
}

/**
 * Reads a stored file. Returns null rather than throwing when the name would
 * escape the upload directory or the file is missing.
 */
export async function read(storedName: string): Promise<Buffer | null> {
  // Reject anything with path structure before touching the filesystem.
  if (storedName.includes("/") || storedName.includes("\\") || storedName.includes("..")) {
    return null;
  }

  const target = path.resolve(UPLOAD_DIR, storedName);
  const root = path.resolve(UPLOAD_DIR);

  // Belt and braces: even after the checks above, confirm containment.
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;

  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

