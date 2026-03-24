param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string]$privateKeyPath = "sealed-secret-backup.yaml",
    [string]$controllerNamespace = "secrets",
    [string]$controllerName = "sealed-secrets"
)

Begin {
    Set-StrictMode -Version Latest

    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
        throw "kubectl is required but not found in PATH."
    }

    if (-not (Get-Command kubeseal -ErrorAction SilentlyContinue)) {
        throw "kubeseal is required but not found in PATH."
    }

    if (-not (Get-Command yq -ErrorAction SilentlyContinue)) {
        throw "yq is required but not found in PATH."
    }

    $resolvedFilePath = (Resolve-Path -Path $FilePath).Path
    $resolvedPrivateKeyPath = (Resolve-Path -Path $privateKeyPath).Path
    $tmpDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("orbit-sealedsecret-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmpDirectory | Out-Null

    $tmpSecretPath = Join-Path $tmpDirectory "secret.dec.yaml"
    $tmpFinalPath = Join-Path $tmpDirectory "sealed-secret.updated.yaml"
    $tmpPrivateKeyPath = Join-Path $tmpDirectory "sealed-secrets.key"
}

Process {
    try {
        $fileContent = Get-Content -Path $resolvedFilePath -Raw
        if ($fileContent -notmatch "(?m)^kind:\s*SealedSecret\s*$") {
            throw "File '$resolvedFilePath' is not a SealedSecret manifest."
        }

        $recoveryPrivateKeyToUse = $resolvedPrivateKeyPath
        if ($resolvedPrivateKeyPath -match "\.ya?ml$") {
            $encodedPrivateKey = yq '.items[0].data."tls.key" // .data."tls.key" // ""' $resolvedPrivateKeyPath
            if (-not $encodedPrivateKey) {
                throw "Unable to read tls.key from '$resolvedPrivateKeyPath'."
            }

            [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encodedPrivateKey)) | Out-File -FilePath $tmpPrivateKeyPath -Encoding utf8
            $recoveryPrivateKeyToUse = $tmpPrivateKeyPath
        }

        kubeseal `
            --controller-namespace $controllerNamespace `
            --controller-name $controllerName `
            --recovery-unseal `
            --sealed-secret-file $resolvedFilePath `
            --recovery-private-key $recoveryPrivateKeyToUse `
            | Out-File -FilePath $tmpSecretPath -Encoding utf8

        yq '.stringData = (.data // {} | with_entries(.value |= @base64d)) | del(.data)' $tmpSecretPath | Out-File -FilePath $tmpSecretPath -Encoding utf8

        $editor = $env:VISUAL
        if (-not $editor) { $editor = $env:EDITOR }
        if (-not $editor) { $editor = "vi" }

        & $editor $tmpSecretPath
        if ($LASTEXITCODE -ne 0) {
            throw "Editor exited with code $LASTEXITCODE"
        }

        $scope = "strict"
        $clusterWide = yq '.metadata.annotations."sealedsecrets.bitnami.com/cluster-wide" // .spec.template.metadata.annotations."sealedsecrets.bitnami.com/cluster-wide" // "false"' $resolvedFilePath
        if ($clusterWide -eq "true") {
            $scope = "cluster-wide"
        }
        else {
            $namespaceWide = yq '.metadata.annotations."sealedsecrets.bitnami.com/namespace-wide" // .spec.template.metadata.annotations."sealedsecrets.bitnami.com/namespace-wide" // "false"' $resolvedFilePath
            if ($namespaceWide -eq "true") {
                $scope = "namespace-wide"
            }
        }

        $namespace = yq '.metadata.namespace // .spec.template.metadata.namespace // ""' $resolvedFilePath
        if ((-not $namespace) -and $scope -ne "cluster-wide") {
            throw "Unable to determine namespace from '$resolvedFilePath'. Set metadata.namespace or spec.template.metadata.namespace."
        }

        $secretName = yq '.spec.template.metadata.name // .metadata.name // ""' $resolvedFilePath
        if (-not $secretName) {
            throw "Unable to determine secret name from '$resolvedFilePath'."
        }

        $env:SEALED_FILE_PATH = $resolvedFilePath
        $env:NAMESPACE = $namespace
        $env:SECRET_NAME = $secretName

        $setSecretMetadataExpression = '.metadata.name = strenv(SECRET_NAME)'
        if ($namespace) {
            $setSecretMetadataExpression = '.metadata.namespace = strenv(NAMESPACE) | ' + $setSecretMetadataExpression
        }

        yq $setSecretMetadataExpression $tmpSecretPath |
            kubeseal `
                --scope $scope `
                --controller-namespace $controllerNamespace `
                --controller-name $controllerName `
                -o yaml |
            yq '.metadata = load(strenv(SEALED_FILE_PATH)).metadata |
                .spec.template.metadata = load(strenv(SEALED_FILE_PATH)).spec.template.metadata' - |
            yq 'del(.metadata.namespace) | .metadata = load(strenv(SEALED_FILE_PATH)).metadata' - |
            Out-File -FilePath $tmpFinalPath -Encoding utf8

        Move-Item -Force -Path $tmpFinalPath -Destination $resolvedFilePath
    }
    finally {
        if (Test-Path $tmpDirectory) {
            Remove-Item -Path $tmpDirectory -Recurse -Force
        }
    }
}
