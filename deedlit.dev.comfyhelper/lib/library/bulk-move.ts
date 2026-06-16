export interface MoveResult {
  moved: string[];
  failed: { id: string; error: string }[];
}

export async function moveImages(ids: string[], targetFolder: string): Promise<MoveResult> {
  const r = await fetch("/api/library/images/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageIds: ids, targetFolder }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Move failed");
  return j as MoveResult;
}
