import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getImageById } from "@/features/gallery/server/image-index";

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => isDev && console.log('[IMAGE_ROUTE]', ...args);

const IMAGE_DIR = path.join(process.cwd(), "public", "images");
const ALLOWED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg"]);
const REMOVABLE_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);

// Input validation patterns
const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LENGTH = 100;

function stripPngMetadata(buffer: Buffer) {
  if (buffer.length < 8) return buffer;
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) return buffer;

  const chunks: Buffer[] = [buffer.subarray(0, 8)];
  let offset = 8;
  let removedChunks = 0;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const fullEnd = dataEnd + 4;
    if (fullEnd > buffer.length) break;

    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const fullChunk = buffer.subarray(offset, fullEnd);
    if (!REMOVABLE_PNG_CHUNKS.has(type)) {
      chunks.push(fullChunk);
    } else {
      removedChunks++;
    }

    offset = fullEnd;
    if (type === "IEND") break;
  }

  const result = Buffer.concat(chunks);
  if (removedChunks > 0) {
    const reduction = buffer.length - result.length;
    log(`[INFO] Stripped ${removedChunks} metadata chunks (saved ${reduction} bytes, ${((reduction / buffer.length) * 100).toFixed(1)}%)`);
  }
  
  return result;
}

export async function GET(request: Request) {
  const startTime = performance.now();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  
  log(`[DEBUG] Image request: ${id || '<missing>'}`);
  
  // Validate request method
  if (request.method !== 'GET') {
    return new NextResponse("Method not allowed", { 
      status: 405,
      headers: { "Allow": "GET" }
    });
  }
  
  // Validate id parameter exists
  if (!id) {
    log('[ERROR] Request missing id parameter');
    return new NextResponse("Missing id", { status: 400 });
  }

  // Validate id format and length (prevent injection attacks)
  if (!VALID_ID_PATTERN.test(id) || id.length > MAX_ID_LENGTH) {
    log(`[ERROR] Invalid id format: ${id}`);
    return new NextResponse("Invalid id", { status: 400 });
  }

  const image = await getImageById(id);
  if (!image) {
    log(`[ERROR] Image not found: ${id}`);
    return new NextResponse("Not found", { status: 404 });
  }

  const filename = image.filename;
  const ext = path.extname(filename).toLowerCase();
  
  log(`[INFO] Found image: ${filename} (ext: ${ext})`);
  
  if (!ALLOWED_EXTS.has(ext)) {
    log(`[ERROR] Unsupported file type: ${ext}`);
    return new NextResponse("Unsupported type", { status: 400 });
  }

  const filePath = path.join(IMAGE_DIR, filename);

  // Prevent path traversal attacks
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(IMAGE_DIR))) {
    log(`[WARN] Path traversal attempt detected: ${filename}`);
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const original = await fs.readFile(filePath);
    log(`[INFO] Read file: ${original.length} bytes`);
    
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".avif"
              ? "image/avif"
              : "image/svg+xml";

    const body = ext === ".png" ? stripPngMetadata(original) : original;

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    log(`[SUCCESS] Served image in ${duration}ms (${body.length} bytes, ${contentType})`);

    return new NextResponse(body as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Content-Disposition": `inline; filename="image-${id}${ext}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      }
    });
  } catch (error) {
    log('[ERROR] Error reading file:', error);
    return new NextResponse("Not found", { status: 404 });
  }
}
