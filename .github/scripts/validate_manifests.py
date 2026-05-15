#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path("kubernetes")
KUSTOMIZATION_FILENAMES = {"kustomization.yaml", "kustomization.yml", "Kustomization"}
IGNORED_MANIFESTS = {
    Path("kubernetes/storage/longhorn/longhorn.yaml"),
    Path("kubernetes/common/cluster-secrets.sops.yaml"),
}


def is_remote_reference(reference: str) -> bool:
    return "://" in reference or reference.startswith("github.com/")


def collect_manifests() -> list[Path]:
    manifests: list[Path] = []
    for path in ROOT.rglob("*.yaml"):
        if path.name in KUSTOMIZATION_FILENAMES:
            continue
        if "charts" in path.parts:
            continue
        try:
            with path.open() as handle:
                docs = list(yaml.safe_load_all(handle))
        except Exception:
            continue

        if any(
            isinstance(doc, dict) and "apiVersion" in doc and "kind" in doc
            for doc in docs
            if doc
        ) and path not in IGNORED_MANIFESTS:
            manifests.append(path)

    return manifests


def iter_kustomization_references(kustomization_path: Path, data: dict) -> list[str]:
    references: list[str] = []

    for key in ("resources", "bases", "components", "patchesStrategicMerge"):
        for item in data.get(key, []) or []:
            if isinstance(item, str):
                references.append(item)

    for patch in data.get("patches", []) or []:
        if isinstance(patch, str):
            references.append(patch)
        elif isinstance(patch, dict) and isinstance(patch.get("path"), str):
            references.append(patch["path"])

    return references


def has_kustomization_file(directory: Path) -> bool:
    return any((directory / filename).exists() for filename in KUSTOMIZATION_FILENAMES)


def main() -> int:
    manifests = collect_manifests()
    references: set[Path] = set()
    errors: list[str] = []

    kustomizations = sorted(
        path
        for filename in KUSTOMIZATION_FILENAMES
        for path in ROOT.rglob(filename)
    )

    for path in kustomizations:
        with path.open() as handle:
            data = yaml.safe_load(handle) or {}

        for reference in iter_kustomization_references(path, data):
            if is_remote_reference(reference):
                continue

            resolved_ref = (path.parent / reference).resolve()

            try:
                ref_path = resolved_ref.relative_to(Path.cwd())
            except ValueError:
                errors.append(
                    f"{path.as_posix()}: reference '{reference}' resolves outside the repository"
                )
                continue

            references.add(ref_path)

            if not resolved_ref.exists():
                errors.append(
                    f"{path.as_posix()}: reference '{reference}' does not exist"
                )
                continue

            if resolved_ref.is_dir() and not has_kustomization_file(resolved_ref):
                errors.append(
                    f"{path.as_posix()}: directory reference '{reference}' is missing a kustomization file"
                )

    missing = sorted(manifest for manifest in manifests if manifest not in references)
    if missing:
        errors.append("The following manifests are not referenced by any kustomization file:")
        errors.extend(f"  - {manifest.as_posix()}" for manifest in missing)

    if errors:
        print("❌ Manifest validation failed:")
        for error in errors:
            print(error)
        return 1

    print("✅ All manifests are referenced and all kustomization references resolve correctly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
