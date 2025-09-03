import os
import yaml

def validate_argocd_revisions(base_folder, project_file):
    errors = []

    def check_file(file_path):
        with open(file_path, 'r') as f:
            docs = list(yaml.safe_load_all(f))
            for doc in docs:
                if not isinstance(doc, dict):
                    continue
                kind = doc.get("kind")
                if kind != "ApplicationSet":
                    continue
                
                # Check revision in generators.git
                generators = doc.get("spec", {}).get("generators", [])
                for g in generators:
                    git = g.get("git")
                    if git:
                        revision = git.get("revision")
                        if revision != "main":
                            errors.append(f"{file_path}: revision is '{revision}', should be 'main'")

                # Check targetRevision in template.spec.source
                template_spec_source = (
                    doc.get("template", {})
                    .get("spec", {})
                    .get("source")
                )

                if template_spec_source and "targetRevision" in template_spec_source:
                    target_revision = template_spec_source.get("targetRevision")
                    if target_revision != "main":
                        errors.append(f"{file_path}: targetRevision is '{target_revision}', should be 'main'")

    # Check all YAML files in the folder
    for root, _, files in os.walk(base_folder):
        for file in files:
            if file.endswith(('.yaml', '.yml')):
                check_file(os.path.join(root, file))

    # Check the single project file
    if os.path.exists(project_file):
        check_file(project_file)
    else:
        errors.append(f"Project file not found: {project_file}")

    if errors:
        print("Validation errors found:")
        for err in errors:
            print(" -", err)
        return False
    else:
        print("All revisions are set to 'main'.")
        return True


# Example usage
if not validate_argocd_revisions("./projects", "./apps/platform/defaults/base/projects.yaml"):
    print("⚠️  Warning: Some revisions are not set to 'main'.")
    exit(1)
