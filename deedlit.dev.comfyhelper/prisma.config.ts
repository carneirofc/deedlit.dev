import path from "node:path";
import { defineConfig } from "prisma/config";
import { getStorageConfig } from "./lib/storage-paths";

const storageConfig = getStorageConfig();
const DATABASE_PATH = storageConfig.databasePath;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `file:${path.resolve(DATABASE_PATH)}`,
  },
});
