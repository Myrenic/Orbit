param(
    [string]$password,
    [Parameter(Mandatory = $true)]
    [string]$namespace,
    [Parameter(Mandatory = $true)]
    [string]$secretName,
    [Parameter(Mandatory = $true)]
    [string]$key,
    [ValidateSet("strict", "namespace-wide", "cluster-wide")]
    [string]$scope = "strict",
    [string]$controllerNamespace = "secrets",
    [string]$controllerName = "sealed-secrets"
)

Begin {
    # Environment-like variables
    $env:SEALED_SECRETS_CONTROLLER_NAMESPACE = $controllerNamespace
    $env:SEALED_SECRETS_CONTROLLER_NAME = $controllerName
    $env:SEALED_SECRETS_SCOPE = $scope
}

Process {
    # Generate random password if no input is provided 
    if (!$password) {
        Write-Host "No password provided. Generating a random password..."
        $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        $password = -join (1..64 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    }

    # Create secret and seal it
    $encryptedSecret = kubectl create secret generic $secretName `
        --namespace $namespace `
        --dry-run=client `
        --from-literal "$key=$password" `
        -o json |
        kubeseal `
        --scope $scope `
        -o json | ConvertFrom-Json

    $encryptedPassword = $encryptedSecret.spec.encryptedData.$key
    if (-not $encryptedPassword) {
        throw "Failed to find encrypted value for key '$key'."
    }
}

End {
    Write-Host ""
    Write-Host $encryptedPassword
    Write-Host ""
    Set-Clipboard $encryptedPassword -AsOSC52
}
