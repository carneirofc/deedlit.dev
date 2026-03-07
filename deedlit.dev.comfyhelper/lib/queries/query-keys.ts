export const queryKeys = {
  roots: () => ["roots"] as const,

  settings: () => ["settings"] as const,

  system: () => ["system"] as const,

  library: () => ["library"] as const,

  images: (filters?: { page?: number; pageSize?: number; search?: string }) =>
    filters ? (["images", filters] as const) : (["images"] as const),

  imageDetail: (id: string | null) => ["imageDetail", id] as const,

  stats: () => ["stats"] as const,

  notes: () => ["notes"] as const,

  noteDetail: (id: string | null) => ["noteDetail", id] as const,

  notesByImage: (imageCacheId: string | null) => ["notesByImage", imageCacheId] as const,
};
