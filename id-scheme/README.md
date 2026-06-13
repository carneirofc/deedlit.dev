# Cross-service ID scheme

This directory freezes the identity scheme every deedlit service shares. There is
**no shared source package** — each service owns a *copy* of the reference helper
(TypeScript in `comfyhelper`, Python in every FastAPI service). They are kept from
diverging by the shared test vectors in [`vectors.json`](vectors.json), which every
copy must reproduce exactly.

## Derivation

1. The canonical cross-service id of an image is the **SHA-256 of its raw bytes**,
   lowercase hex. This is the catalog primary key and is carried in every payload.
2. The Qdrant point id is **`uuid5(NAMESPACE, sha256-hex)`** — a deterministic
   RFC-4122 v5 UUID. The full sha256 hex is still carried in the Qdrant payload so
   the point is self-describing.

## Canonical namespace

```
NAMESPACE = 697124e2-0736-5d17-812d-590ba305cb45
          = uuid5(URL_NAMESPACE, "https://deedlit.dev/id-scheme/v1")
```

The namespace itself is derived deterministically from a project URL so it can be
re-verified, but in code it is hard-coded as the literal constant above. **Never
change it** — it would orphan every existing Qdrant point.

## Reference implementations

| Language   | File                                              |
|------------|---------------------------------------------------|
| TypeScript | `deedlit.dev.comfyhelper/lib/library/id-scheme.ts` |
| Python     | `deedlit.vision/id_scheme.py` (copied per service) |

Both expose `pointIdForSha256(sha256hex) -> uuid` and the `NAMESPACE` constant, and
both are tested against [`vectors.json`](vectors.json).
