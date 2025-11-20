param(
    [string]$password
)

Begin {
    # Environment-like variables
    $env:SEALED_SECRETS_CONTROLLER_NAMESPACE = "secrets"
    $env:SEALED_SECRETS_CONTROLLER_NAME = "sealed-secrets"
    $env:SEALED_SECRETS_SCOPE = "cluster-wide"
}

Process {
    # Generate random password if no input is provided 
    if (!$password) {
        Write-Host "No password provided. Generating a random password..."
        $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        $password = -join (1..64 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    }

    # Create secret and seal it
    $encryptedPassword = kubectl create secret generic script `
        --dry-run=client `
        --from-literal "script=$password" `
        -o json |
        kubeseal -o json |
        jq -r '.spec.encryptedData.script'
}

End {
    Write-Host ""
    Write-Host $encryptedPassword
    Write-Host ""
    Set-Clipboard $encryptedPassword -AsOSC52
}
