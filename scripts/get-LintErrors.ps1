Begin {
# Ensure script runs from git repo root
    if (-not (Test-Path ".git")) {
        Write-Error "must be run from the root of the git repository."
        exit 1
    }
}

Process {
    # Find all YAML files tracked by Git
    $yamlFiles = git ls-files '*.yml' '*.yaml'
}

End {
    if ($yamlFiles) {
        # Run yamllint on each file
        foreach ($file in $yamlFiles) {
            yamllint $file
        }
    } else {
        Write-Host "No YAML files found."
    }
}
