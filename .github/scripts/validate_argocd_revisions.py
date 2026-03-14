import os
import yaml

def validate_argocd_revisions(values_file):
    errors = []

    if not values_file:
        errors.append("No values file path was provided.")
    elif not os.path.exists(values_file):
        errors.append(f"Values file not found: {values_file}")
    else:
        with open(values_file, 'r') as f:
            data = yaml.safe_load(f) or {}

        appsets = data.get("applicationsets", {})
        for appset_name, appset in appsets.items():
            generators = appset.get("generators", [])
            for g in generators:
                git = g.get("git")
                if git:
                    revision = git.get("revision")
                    if revision != "main":
                        errors.append(
                            f"{values_file} ({appset_name}): revision is '{revision}', should be 'main'"
                        )

            template_spec_source = (
                appset.get("template", {})
                .get("spec", {})
                .get("source")
            )
            if template_spec_source and "targetRevision" in template_spec_source:
                target_revision = template_spec_source.get("targetRevision")
                if target_revision != "main":
                    errors.append(
                        f"{values_file} ({appset_name}): targetRevision is '{target_revision}', should be 'main'"
                    )

    if errors:
        print("Validation errors found:")
        for err in errors:
            print(" -", err)
        return False
    else:
        print("All revisions are set to 'main'.")
        return True


# Example usage
if not validate_argocd_revisions("./kubernetes/argocd/argocd-apps/values.yaml"):
    print("⚠️  Warning: Some revisions are not set to 'main'.")
    exit(1)
