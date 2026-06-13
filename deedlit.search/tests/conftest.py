"""Test config: point the service at a throwaway Qdrant collection.

The env vars MUST be set before ``app`` is imported anywhere, because the app
constructs its live ``SearchStore`` (and thus reads ``QDRANT_COLLECTION``) at
import time. Setting them here in conftest guarantees they win for the whole
test session regardless of import order.
"""
from __future__ import annotations

import os

# Deterministic-but-unique collection name so concurrent/leftover runs never
# collide with the real ``images`` collection. Fixtures drop it on teardown.
TEST_COLLECTION = "deedlit_search_test_0f1e2d3c"

os.environ.setdefault("QDRANT_URL", "http://localhost:6333")
os.environ["QDRANT_COLLECTION"] = TEST_COLLECTION
