import type { PoolClient } from "pg";

/**
 * Infer a coarse model family from a checkpoint/model name so search filters
 * like `model_family = sdxl` work without manual tagging.
 */
export function inferModelFamily(name: string): string | null {
  const n = name.toLowerCase();
  if (/(sdxl|xl|illustrious|pony|animagine|noobai)/.test(n)) return "sdxl";
  if (/(sd3|stable.?diffusion.?3)/.test(n)) return "sd3";
  if (/flux/.test(n)) return "flux";
  if (/(sd15|sd1\.5|v1-5|1\.5)/.test(n)) return "sd15";
  if (/(sd2|2\.1|v2-1)/.test(n)) return "sd2";
  return null;
}

export async function upsertModel(
  client: PoolClient,
  name: string,
  family: string | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO models (name, family)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET family = COALESCE(models.family, EXCLUDED.family)
     RETURNING id`,
    [name, family ?? inferModelFamily(name)],
  );
  return result.rows[0].id;
}

export async function upsertCheckpoint(
  client: PoolClient,
  name: string,
  modelId: string | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO checkpoints (name, model_id)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET model_id = COALESCE(checkpoints.model_id, EXCLUDED.model_id)
     RETURNING id`,
    [name, modelId],
  );
  return result.rows[0].id;
}

export async function upsertLora(client: PoolClient, name: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO loras (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  );
  return result.rows[0].id;
}

export async function linkImageLora(
  client: PoolClient,
  imageId: string,
  loraId: string,
  weight: number | null,
  source: string,
): Promise<void> {
  await client.query(
    `INSERT INTO image_loras (image_id, lora_id, weight, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (image_id, lora_id) DO UPDATE SET weight = EXCLUDED.weight`,
    [imageId, loraId, weight, source],
  );
}
