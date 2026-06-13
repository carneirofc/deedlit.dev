"""ID-scheme reference tests, pinned to the shared cross-language vectors."""
import json
from pathlib import Path

import pytest

from id_scheme import NAMESPACE, point_id_for_sha256

_VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "id-scheme" / "vectors.json").read_text()
)


def test_namespace_matches_frozen_constant():
    assert str(NAMESPACE) == _VECTORS["namespace"]


@pytest.mark.parametrize("vector", _VECTORS["vectors"], ids=lambda v: v["label"])
def test_point_id_reproduces_shared_vector(vector):
    assert point_id_for_sha256(vector["sha256"]) == vector["pointId"]
