import path from "node:path";
import { defineConfig } from "prisma/config";

const DATABASE_PATH = path.join("data", "comfyhelper.db");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `file:${DATABASE_PATH}`,
  },
});
