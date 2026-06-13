"""Validate the deedlit OpenAPI contract sketches.

Run: uv run --with openapi-spec-validator --with pyyaml python contracts/validate.py
Asserts every sketch is valid OpenAPI 3.1 and carries the cross-cutting shapes
(metadata reference-graph categories, search RRF hybrid response).
"""
import glob
import sys

import yaml
from openapi_spec_validator import validate

REF_CATEGORIES = ["checkpoints", "loras", "embeddings", "vae", "controlnets", "upscalers"]


def main() -> int:
    ok = True
    for path in sorted(glob.glob("contracts/*.openapi.yaml")):
        try:
            spec = yaml.safe_load(open(path, encoding="utf-8"))
            validate(spec)
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"INVALID  {path}: {type(e).__name__}: {str(e)[:160]}")
            continue
        schemas = spec.get("components", {}).get("schemas", {})
        if path.endswith("metadata.openapi.yaml"):
            refs = schemas["References"]["properties"]
            missing = [c for c in REF_CATEGORIES if c not in refs]
            if missing:
                ok = False
                print(f"FAIL     {path}: references missing {missing}")
                continue
        if path.endswith("search.openapi.yaml"):
            fusion = schemas["QueryResponse"]["properties"]["fusion"]["enum"]
            if "rrf" not in fusion:
                ok = False
                print(f"FAIL     {path}: search response missing rrf fusion")
                continue
        name = path.replace("\\", "/").split("/")[-1]
        print(f"OK       {name:24} ({len(spec.get('paths', {}))} paths, {len(schemas)} schemas)")
    print("ALL VALID" if ok else "FAILURES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
