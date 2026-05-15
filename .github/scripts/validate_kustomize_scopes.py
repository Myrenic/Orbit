#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
KUBERNETES_ROOT = REPO_ROOT / "kubernetes"
KUSTOMIZATION_FILENAMES = ("kustomization.yaml", "kustomization.yml", "Kustomization")


def run_git_changed_files(base_ref: str | None) -> list[Path]:
    diff_range = None
    resolved_base_ref = base_ref or os.environ.get("GITHUB_BASE_REF")

    if resolved_base_ref:
        diff_range = f"origin/{resolved_base_ref}...HEAD"
    else:
        head_parent = subprocess.run(
            ["git", "rev-parse", "--verify", "HEAD~1"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        if head_parent.returncode == 0:
            diff_range = "HEAD~1...HEAD"

    command = ["git", "--no-pager", "diff", "--name-only"]
    if diff_range:
        command.append(diff_range)
    command.extend(["--", "kubernetes", "helm-charts", ".github/scripts", ".github/workflows"])

    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Unable to determine changed files from git.")

    return [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]


def all_kustomization_scopes() -> list[Path]:
    scopes = {
        path.parent.relative_to(REPO_ROOT)
        for filename in KUSTOMIZATION_FILENAMES
        for path in KUBERNETES_ROOT.rglob(filename)
    }
    return sorted(scopes)


def find_scope_for_path(relative_path: Path) -> Path | None:
    candidate = (REPO_ROOT / relative_path).resolve()
    if candidate.is_file():
        candidate = candidate.parent

    while True:
        for filename in KUSTOMIZATION_FILENAMES:
            if (candidate / filename).exists():
                return candidate.relative_to(REPO_ROOT)
        if candidate == REPO_ROOT:
            return None
        candidate = candidate.parent


def detect_impacted_scopes(changed_files: list[Path]) -> list[Path]:
    if not changed_files:
        return []

    if any(path.parts and path.parts[0] == "helm-charts" for path in changed_files):
        return all_kustomization_scopes()

    if any(
        path.as_posix().startswith(".github/scripts/")
        or path.as_posix().startswith(".github/workflows/")
        for path in changed_files
    ):
        return all_kustomization_scopes()

    scopes: set[Path] = set()
    for path in changed_files:
        if not path.parts or path.parts[0] != "kubernetes":
            continue
        scope = find_scope_for_path(path)
        if scope is not None:
            scopes.add(scope)

    return sorted(scopes)


def build_scope(scope: Path) -> None:
    command = [
        "kustomize",
        "build",
        scope.as_posix(),
        "--load-restrictor",
        "LoadRestrictionsNone",
        "--enable-helm",
    ]
    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(f"❌ kustomize build failed for {scope.as_posix()}\n")
        if result.stdout:
            sys.stderr.write(result.stdout)
        if result.stderr:
            sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)

    print(f"✅ {scope.as_posix()}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the impacted kustomize scopes.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Validate every kustomization under kubernetes/.",
    )
    parser.add_argument(
        "--base-ref",
        help="Git base ref used to compute changed files (for example: main).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    changed_files = [] if args.all else run_git_changed_files(args.base_ref)
    scopes = all_kustomization_scopes() if args.all else detect_impacted_scopes(changed_files)

    if changed_files:
        print("Changed files considered for kustomize validation:")
        for changed_file in changed_files:
            print(f" - {changed_file.as_posix()}")

    if not scopes:
        print("No impacted kustomize scopes detected.")
        return 0

    print("Validating kustomize scopes:")
    for scope in scopes:
        print(f" - {scope.as_posix()}")

    for scope in scopes:
        build_scope(scope)

    print(f"Validated {len(scopes)} kustomize scope(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
