"""Qdrant store: collection lifecycle + dense/sparse upsert + RRF hybrid query.

This is the only place that talks to Qdrant. The collection uses *named*
vectors: a regular dense vector named ``dense`` (1024-dim, cosine) and a sparse
vector named ``sparse`` (SPLADE term weights). Hybrid search issues a single
Query API call with one prefetch per modality and fuses them with RRF.

Point ids are ``uuid5(NAMESPACE, sha256)`` (see id_scheme); the full sha256 is
also carried in the payload so hits can be mapped back to the cross-service id
without reversing the uuid5.
"""
from __future__ import annotations

from typing import Any

from qdrant_client import QdrantClient, models

from id_scheme import point_id_for_sha256
from search.config import (
    DENSE_VECTOR_NAME,
    DESCRIPTION_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
    SearchConfig,
)
from search.schemas import Hit, SparseVector

# Where we stash the cross-service sha256 inside each point's payload.
SHA256_PAYLOAD_KEY = "sha256"


class SearchStore:
    """Thin wrapper around qdrant-client for the search service's needs."""

    def __init__(self, config: SearchConfig) -> None:
        self.config = config
        self.client = QdrantClient(url=config.qdrant_url)
        self.collection = config.collection
        # Once we've confirmed/created the collection, remember it so the upsert
        # hot path stops probing Qdrant (`collection_exists`) on every single
        # point — that probe was a full Qdrant round-trip per upsert. Reset by
        # drop_collection so a rebuild re-creates it. A stale-True only costs one
        # failed upsert that the broker retries, so the unsynchronised bool is safe.
        self._ensured = False

    # -- lifecycle ----------------------------------------------------------

    def collection_exists(self) -> bool:
        return self.client.collection_exists(self.collection)

    def ensure_collection(self) -> None:
        """Create the collection with named dense + sparse vectors if missing.

        Cached after the first success: the per-upsert call is then a no-op (no
        Qdrant round-trip), so a burst of index.search upserts hits Qdrant once
        per point instead of twice.
        """
        if self._ensured:
            return
        if self.collection_exists():
            self._ensured = True
            return
        self.client.create_collection(
            collection_name=self.collection,
            vectors_config={
                DENSE_VECTOR_NAME: models.VectorParams(
                    size=self.config.dense_dim,
                    distance=models.Distance.COSINE,
                ),
                # CLIP text embedding of the AI description — same space/dim as the
                # image vector, indexed under its own name so it can be queried
                # independently. Stored per-point only when a description exists.
                DESCRIPTION_VECTOR_NAME: models.VectorParams(
                    size=self.config.dense_dim,
                    distance=models.Distance.COSINE,
                ),
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: models.SparseVectorParams(
                    index=models.SparseIndexParams(),
                ),
            },
        )
        self._ensured = True

    def drop_collection(self) -> None:
        if self.collection_exists():
            self.client.delete_collection(self.collection)
        self._ensured = False  # force the next ensure_collection to recreate

    def close(self) -> None:
        self.client.close()

    # -- writes -------------------------------------------------------------

    def _point_struct(
        self,
        sha256: str,
        dense: list[float],
        sparse: SparseVector | None,
        payload: dict[str, Any] | None,
        description: list[float] | None = None,
    ) -> Any:
        """Build one PointStruct (id = uuid5(sha256), named vectors + payload).

        ``description`` is the optional CLIP-text vector; stored under its own
        named vector only when present so a point without one still indexes on
        ``dense`` (+ ``sparse``)."""
        vector: dict[str, Any] = {DENSE_VECTOR_NAME: dense}
        if description is not None:
            vector[DESCRIPTION_VECTOR_NAME] = description
        if sparse is not None:
            vector[SPARSE_VECTOR_NAME] = models.SparseVector(
                indices=sparse.indices, values=sparse.values
            )
        full_payload = dict(payload or {})
        # Always carry the canonical cross-service id in the payload.
        full_payload[SHA256_PAYLOAD_KEY] = sha256.lower()
        return models.PointStruct(
            id=point_id_for_sha256(sha256), vector=vector, payload=full_payload
        )

    def upsert_point(
        self,
        sha256: str,
        dense: list[float],
        sparse: SparseVector | None,
        payload: dict[str, Any] | None,
        description: list[float] | None = None,
    ) -> str:
        """Upsert one point keyed by uuid5(sha256). Returns the point id."""
        return self.upsert_points(
            [(sha256, dense, sparse, payload, description)]
        )[0]

    def upsert_points(
        self,
        items: list[tuple[str, list[float], SparseVector | None, dict[str, Any] | None, list[float] | None]],
    ) -> list[str]:
        """Upsert MANY points in ONE Qdrant call. Returns the point ids in order.

        The ingest hot path posts one point per image, but a scaled worker pool
        lands hundreds concurrently; coalescing them into a single ``upsert`` (one
        Qdrant round-trip + one WAL flush for the whole batch instead of per point)
        is the dominant throughput lever for index.search. ``wait=True`` so the
        batch is queryable the moment this returns — every caller that awaited this
        flush keeps read-after-write. Idempotent: a duplicate point id just
        overwrites.
        """
        if not items:
            return []
        points = [self._point_struct(*item) for item in items]
        self.client.upsert(collection_name=self.collection, points=points, wait=True)
        return [p.id for p in points]

    def delete_point(self, sha256: str) -> str:
        """Delete the point keyed by ``uuid5(sha256)``. Idempotent.

        Returns the derived point id. Qdrant's delete-by-id is a no-op when the
        point is absent, so calling this for an unknown sha256 still succeeds —
        which is what the gateway's best-effort projection cleanup wants.
        """
        point_id = point_id_for_sha256(sha256)
        self.client.delete(
            collection_name=self.collection,
            points_selector=models.PointIdsList(points=[point_id]),
        )
        return point_id

    def delete_points(self, sha256s: list[str]) -> list[str]:
        """Delete MANY points (by ``uuid5(sha256)``) in ONE Qdrant call. Idempotent.

        The batch counterpart to :meth:`delete_point`: one delete-by-ids round-trip
        for the whole set instead of one per image, so a bulk un-index is a single
        Qdrant op. Missing ids are no-ops. Returns the derived point ids.
        """
        if not sha256s:
            return []
        point_ids = [point_id_for_sha256(s) for s in sha256s]
        self.client.delete(
            collection_name=self.collection,
            points_selector=models.PointIdsList(points=point_ids),
        )
        return point_ids

    # -- reads --------------------------------------------------------------

    def _to_hits(self, points: list[Any]) -> list[Hit]:
        hits: list[Hit] = []
        for p in points:
            payload = p.payload or {}
            sha = payload.get(SHA256_PAYLOAD_KEY)
            if not sha:
                # Can't map back to a cross-service id; skip rather than emit junk.
                continue
            hits.append(Hit(sha256=sha, score=float(p.score), payload=payload))
        return hits

    def _filter(self, raw: dict[str, Any] | None) -> models.Filter | None:
        if not raw:
            return None
        return models.Filter(**raw)

    def query_hybrid(
        self,
        dense: list[float] | None,
        sparse: SparseVector | None,
        limit: int,
        query_filter: dict[str, Any] | None = None,
        description: list[float] | None = None,
        offset: int = 0,
    ) -> tuple[str, list[Hit]]:
        """Run a query and return (fusion, hits).

        Accepts any subset of the three modalities (image ``dense``, ``description``
        text, and lexical ``sparse``). Two or more are RRF-fused over one prefetch
        each; a single modality is a plain nearest-neighbour query named after it.

        ``offset`` pages into the ranked result so search can paginate over the
        WHOLE matching set server-side (not a client-side slice of a fixed top-K).
        For the fused path the prefetch is deepened to ``limit + offset`` so there
        are enough fused candidates to skip past.
        """
        qfilter = self._filter(query_filter)

        # (fusion-name, named-vector, query) per supplied modality, in fusion order.
        modalities: list[tuple[str, str, Any]] = []
        if dense is not None:
            modalities.append(("dense", DENSE_VECTOR_NAME, dense))
        if description is not None:
            modalities.append(("description", DESCRIPTION_VECTOR_NAME, description))
        if sparse is not None:
            modalities.append((
                "sparse",
                SPARSE_VECTOR_NAME,
                models.SparseVector(indices=sparse.indices, values=sparse.values),
            ))

        if not modalities:
            raise ValueError("query requires at least one of dense/description/sparse")

        if len(modalities) == 1:
            name, using, qvec = modalities[0]
            result = self.client.query_points(
                collection_name=self.collection,
                query=qvec,
                using=using,
                limit=limit,
                offset=offset,
                query_filter=qfilter,
                with_payload=True,
            )
            return name, self._to_hits(result.points)

        # Each prefetch must surface enough candidates that the fused result still
        # has `limit` rows AFTER skipping `offset`, so prefetch limit = limit+offset.
        prefetch = [
            models.Prefetch(query=qvec, using=using, limit=limit + offset, filter=qfilter)
            for _, using, qvec in modalities
        ]
        result = self.client.query_points(
            collection_name=self.collection,
            prefetch=prefetch,
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=limit,
            offset=offset,
            with_payload=True,
        )
        return "rrf", self._to_hits(result.points)

    def query_similar(
        self,
        sha256: str,
        limit: int,
        query_filter: dict[str, Any] | None = None,
        offset: int = 0,
    ) -> list[Hit]:
        """Nearest neighbors to a stored point's dense vector (excludes self).

        ``query_filter`` is the SAME payload-filter shape as :meth:`query_hybrid`
        (e.g. a safety/tag filter). Without it, image-to-image search returned
        neighbours across ALL payloads — so the UI's safety/tag filter had no
        effect on by-image results; pass it through so the filter applies here too.

        ``offset`` pages deeper into the ranked neighbours so similar/by-image can
        keep loading more, mirroring /query pagination. The query point itself is
        dropped via a ``must_not`` on its sha256 (rather than over-fetching and
        filtering it out afterwards) so neighbour ranks line up exactly with
        ``offset``/``limit`` — pagination is gapless and never duplicates a row.
        """
        point_id = point_id_for_sha256(sha256)
        # Exclude the query point itself with a payload filter so it never eats a
        # result slot — keeps offset paging exact even when a user filter is also
        # in play (its conditions merge with ours).
        merged = dict(query_filter or {})
        must_not = list(merged.get("must_not") or [])
        must_not.append({"key": SHA256_PAYLOAD_KEY, "match": {"value": sha256.lower()}})
        merged["must_not"] = must_not
        result = self.client.query_points(
            collection_name=self.collection,
            query=point_id,
            using=DENSE_VECTOR_NAME,
            limit=limit,
            offset=offset,
            query_filter=self._filter(merged),
            with_payload=True,
        )
        return self._to_hits(result.points)
