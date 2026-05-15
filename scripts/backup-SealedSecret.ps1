param(
    [string]$controllerNamespace = "secrets",
    [string]$labelSelector = "sealedsecrets.bitnami.com/sealed-secrets-key"
)

Begin {
    Set-StrictMode -Version Latest

    # Determine script directory
    $SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
        throw "kubectl is required but not found in PATH."
    }
}

Process {
    # Backup sealed-secrets to YAML
    $backupPath = Join-Path $SCRIPT_DIR "..\sealed-secret-backup.yaml"
    kubectl get secret -n $controllerNamespace -l $labelSelector -o yaml |
        Set-Content -Path $backupPath
}

End {
    Write-Host "Backup saved to $backupPath"
}
