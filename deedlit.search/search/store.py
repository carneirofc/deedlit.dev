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

    # -- lifecycle ----------------------------------------------------------

    def collection_exists(self) -> bool:
        return self.client.collection_exists(self.collection)

    def ensure_collection(self) -> None:
        """Create the collection with named dense + sparse vectors if missing."""
        if self.collection_exists():
            return
        self.client.create_collection(
            collection_name=self.collection,
            vectors_config={
                DENSE_VECTOR_NAME: models.VectorParams(
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

    def drop_collection(self) -> None:
        if self.collection_exists():
            self.client.delete_collection(self.collection)

    def close(self) -> None:
        self.client.close()

    # -- writes -------------------------------------------------------------

    def upsert_point(
        self,
        sha256: str,
        dense: list[float],
        sparse: SparseVector | None,
        payload: dict[str, Any] | None,
    ) -> str:
        """Upsert one point keyed by uuid5(sha256). Returns the point id."""
        point_id = point_id_for_sha256(sha256)

        vector: dict[str, Any] = {DENSE_VECTOR_NAME: dense}
        if sparse is not None:
            vector[SPARSE_VECTOR_NAME] = models.SparseVector(
                indices=sparse.indices, values=sparse.values
            )

        full_payload = dict(payload or {})
        # Always carry the canonical cross-service id in the payload.
        full_payload[SHA256_PAYLOAD_KEY] = sha256.lower()

        self.client.upsert(
            collection_name=self.collection,
            points=[
                models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=full_payload,
                )
            ],
        )
        return point_id

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
    ) -> tuple[str, list[Hit]]:
        """Run a query and return (fusion, hits).

        - both dense+sparse  -> RRF fusion over two prefetches
        - dense only         -> nearest on the dense named vector
        - sparse only        -> nearest on the sparse named vector
        """
        qfilter = self._filter(query_filter)

        if dense is not None and sparse is not None:
            prefetch = [
                models.Prefetch(
                    query=dense,
                    using=DENSE_VECTOR_NAME,
                    limit=limit,
                    filter=qfilter,
                ),
                models.Prefetch(
                    query=models.SparseVector(
                        indices=sparse.indices, values=sparse.values
                    ),
                    using=SPARSE_VECTOR_NAME,
                    limit=limit,
                    filter=qfilter,
                ),
            ]
            result = self.client.query_points(
                collection_name=self.collection,
                prefetch=prefetch,
                query=models.FusionQuery(fusion=models.Fusion.RRF),
                limit=limit,
                with_payload=True,
            )
            return "rrf", self._to_hits(result.points)

        if dense is not None:
            result = self.client.query_points(
                collection_name=self.collection,
                query=dense,
                using=DENSE_VECTOR_NAME,
                limit=limit,
                query_filter=qfilter,
                with_payload=True,
            )
            return "dense", self._to_hits(result.points)

        if sparse is not None:
            result = self.client.query_points(
                collection_name=self.collection,
                query=models.SparseVector(
                    indices=sparse.indices, values=sparse.values
                ),
                using=SPARSE_VECTOR_NAME,
                limit=limit,
                query_filter=qfilter,
                with_payload=True,
            )
            return "sparse", self._to_hits(result.points)

        raise ValueError("query requires at least one of dense/sparse")

    def query_similar(self, sha256: str, limit: int) -> list[Hit]:
        """Nearest neighbors to a stored point's dense vector (excludes self)."""
        point_id = point_id_for_sha256(sha256)
        # Ask for one extra so we can drop the query point itself.
        result = self.client.query_points(
            collection_name=self.collection,
            query=point_id,
            using=DENSE_VECTOR_NAME,
            limit=limit + 1,
            with_payload=True,
        )
        hits = self._to_hits(result.points)
        return [h for h in hits if h.sha256 != sha256.lower()][:limit]
