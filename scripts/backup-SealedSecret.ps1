Begin {
    # Determine script directory
    $SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
}

Process {
    # Backup sealed-secrets to YAML
    $backupPath = Join-Path $SCRIPT_DIR "..\sealed-secret-backup.yaml"
    kubectl get secret -n sealed-secrets -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml > $backupPath
}

End {
    Write-Host "Backup saved to $backupPath"
}
