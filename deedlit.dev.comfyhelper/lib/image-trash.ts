import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

export async function moveToTrash(sourcePath: string, trashDirectory: string): Promise<void> {
  await mkdir(trashDirectory, { recursive: true });
  const targetPath = path.join(
    trashDirectory,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(sourcePath)}`,
  );

  try {
    await rename(sourcePath, targetPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      throw error;
    }
  }

  await copyFile(sourcePath, targetPath);
  await unlink(sourcePath);
}
