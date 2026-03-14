Begin {
    # No special initialization needed
}

Process {
    # Get ArgoCD initial admin password
    $p = kubectl -n argocd get secret argocd-initial-admin-secret `
        -o jsonpath="{.data.password}" | ForEach-Object { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
}

End {
    Set-Clipboard $p -AsOSC52
    Write-Host $p
}
