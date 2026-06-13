import { open } from "node:fs/promises";
import { inflateSync } from "node:zlib";

type TextChunk = {
  keyword: string;
  chunkType: "tEXt" | "zTXt" | "iTXt";
  text: string;
};

type EmbeddedMetadataResult = {
  metadata?: unknown;
  error?: string;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseTextChunk(data: Buffer): TextChunk | null {
  const separator = data.indexOf(0);
  if (separator <= 0) {
    return null;
  }

  return {
    keyword: data.subarray(0, separator).toString("latin1"),
    chunkType: "tEXt",
    text: data.subarray(separator + 1).toString("latin1"),
  };
}

function parseZtxtChunk(data: Buffer): TextChunk | null {
  const separator = data.indexOf(0);
  if (separator <= 0 || separator + 2 > data.length) {
    return null;
  }

  const compressionMethod = data[separator + 1];
  if (compressionMethod !== 0) {
    return null;
  }

  return {
    keyword: data.subarray(0, separator).toString("latin1"),
    chunkType: "zTXt",
    text: inflateSync(data.subarray(separator + 2)).toString("utf8"),
  };
}

function parseItxtChunk(data: Buffer): TextChunk | null {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd <= 0) {
    return null;
  }

  let offset = keywordEnd + 1;
  if (offset + 2 > data.length) {
    return null;
  }

  const compressionFlag = data[offset];
  const compressionMethod = data[offset + 1];
  offset += 2;

  const languageTagEnd = data.indexOf(0, offset);
  if (languageTagEnd === -1) {
    return null;
  }
  offset = languageTagEnd + 1;

  const translatedKeywordEnd = data.indexOf(0, offset);
  if (translatedKeywordEnd === -1) {
    return null;
  }
  offset = translatedKeywordEnd + 1;

  let textData = data.subarray(offset);
  if (compressionFlag === 1) {
    if (compressionMethod !== 0) {
      return null;
    }
    textData = inflateSync(textData);
  }

  return {
    keyword: data.subarray(0, keywordEnd).toString("latin1"),
    chunkType: "iTXt",
    text: textData.toString("utf8"),
  };
}

function parseChunk(type: string, data: Buffer): TextChunk | null {
  if (type === "tEXt") {
    return parseTextChunk(data);
  }

  if (type === "zTXt") {
    return parseZtxtChunk(data);
  }

  if (type === "iTXt") {
    return parseItxtChunk(data);
  }

  return null;
}

function toMetadataObject(chunks: TextChunk[]): unknown {
  const fields: Record<string, unknown> = {};

  for (const chunk of chunks) {
    const normalizedText = chunk.text.trim();
    const parsedValue: unknown = (() => {
      if (!looksLikeJson(normalizedText)) {
        return normalizedText;
      }

      try {
        return JSON.parse(normalizedText) as unknown;
      } catch {
        return normalizedText;
      }
    })();

    const existing = fields[chunk.keyword];
    if (existing === undefined) {
      fields[chunk.keyword] = parsedValue;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(parsedValue);
      continue;
    }

    fields[chunk.keyword] = [existing, parsedValue];
  }

  return {
    source: "embedded-png",
    fields,
  };
}

export async function readEmbeddedMetadataFromPng(imagePath: string): Promise<EmbeddedMetadataResult> {
  let handle;
  try {
    handle = await open(imagePath, "r");

    // Read and verify PNG signature (8 bytes)
    const signature = Buffer.alloc(8);
    const { bytesRead: sigBytesRead } = await handle.read(signature, 0, 8, 0);
    if (sigBytesRead < 8 || !signature.equals(PNG_SIGNATURE)) {
      return {};
    }

    const chunks: TextChunk[] = [];
    let offset = 8;
    let foundIEND = false;

    // Stream chunks without loading entire file into memory
    while (!foundIEND) {
      // Read chunk header (length + type = 8 bytes)
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, 8, offset);
      if (bytesRead < 8) {
        break;
      }

      const length = header.readUInt32BE(0);
      const type = header.subarray(4, 8).toString("ascii");

      // Only read data for text chunks (significant memory savings)
      if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
        const data = Buffer.alloc(length);
        await handle.read(data, 0, length, offset + 8);
        const parsed = parseChunk(type, data);
        if (parsed) {
          chunks.push(parsed);
        }
      }

      if (type === "IEND") {
        foundIEND = true;
      }

      // Move to next chunk: header (8) + data (length) + CRC (4)
      offset += 8 + length + 4;
    }

    return chunks.length > 0 ? { metadata: toMetadataObject(chunks) } : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PNG metadata parse error";
    return { error: message };
  } finally {
    await handle?.close();
  }
}
