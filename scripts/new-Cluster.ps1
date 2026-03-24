
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AgeKeyFile,

    [string]$GitUrl = "https://github.com/myrenic/orbit.git",
    [string]$GitBranch = "main",
    [string]$ClusterPath = "./kubernetes/clusters/homelab"
)

begin {
    if (-not (Test-Path ".git")) {
        Write-Error "This script must be run from the repository root."
        exit 1
    }

    if (-not (Test-Path $AgeKeyFile)) {
        Write-Error "Age key file not found: $AgeKeyFile"
        exit 1
    }

    # Verify required tools
    foreach ($tool in @("flux", "kubectl", "sops")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Write-Error "$tool is required but not found in PATH."
            exit 1
        }
    }
}

process {
    # Step 1: Pre-flight check
    Write-Host "Running Flux pre-flight check..." -ForegroundColor Cyan
    flux check --pre

    # Step 2: Bootstrap Flux
    Write-Host "Bootstrapping Flux..." -ForegroundColor Cyan
    flux bootstrap github `
        --owner=myrenic `
        --repository=orbit `
        --branch=$GitBranch `
        --path=$ClusterPath `
        --personal

    # Step 3: Create SOPS age secret for Flux decryption
    Write-Host "Creating SOPS age secret in flux-system namespace..." -ForegroundColor Cyan
    kubectl create secret generic sops-age `
        --namespace=flux-system `
        --from-file=age.agekey=$AgeKeyFile `
        --dry-run=client -o yaml | kubectl apply -f -

    # Step 4: Trigger reconciliation
    Write-Host "Triggering Flux reconciliation..." -ForegroundColor Yellow
    flux reconcile source git flux-system
    Start-Sleep -Seconds 5
    flux reconcile kustomization flux-system

    # Step 5: Wait for apps to deploy
    Write-Host "Waiting for apps kustomization..." -ForegroundColor Yellow
    flux get kustomizations --watch
}

end {
    Write-Host ""
    Write-Host "Cluster bootstrap complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Verify with:" -ForegroundColor Cyan
    Write-Host "  flux get all"
    Write-Host "  kubectl get pods --all-namespaces"
}
