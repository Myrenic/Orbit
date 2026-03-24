#!/usr/bin/env python3
import os
import yaml
from pathlib import Path

root = Path("kubernetes")
ignored_manifests = set()

# Directories managed by Flux bootstrap (not referenced in kustomization.yaml)
ignored_dirs = {"clusters"}

# Collect all yaml manifests (skip kustomization.yaml, charts/, and cluster configs)
manifests = []
for path in root.rglob("*.yaml"):
    if path.name == "kustomization.yaml":
        continue
    if "charts" in path.parts:  # skip Helm chart files
        continue
    if any(d in path.parts for d in ignored_dirs):
        continue
    try:
        with open(path) as f:
            docs = list(yaml.safe_load_all(f))
        if any(isinstance(d, dict) and "apiVersion" in d and "kind" in d for d in docs if d):
            manifest_path = os.path.normpath(path.as_posix())
            if manifest_path not in ignored_manifests:
                manifests.append(manifest_path)
    except Exception:
        continue

# Collect all references from kustomization.yaml
references = set()
for path in root.rglob("kustomization.yaml"):
    with open(path) as f:
        data = yaml.safe_load(f) or {}
        for key in ("resources", "bases", "patchesStrategicMerge", "patches"):
            if key in data:
                for r in data[key]:
                    if isinstance(r, str):
                        ref_path = os.path.normpath((path.parent / r).as_posix())
                        references.add(ref_path)

# Check if each manifest is covered
missing = [m for m in manifests if m not in references]

if missing:
    print("❌ The following manifests are not referenced by any kustomization.yaml:")
    for m in missing:
        print(f"  - {m}")
    exit(1)
else:
    print("✅ All manifests are referenced by at least one kustomization.yaml")
