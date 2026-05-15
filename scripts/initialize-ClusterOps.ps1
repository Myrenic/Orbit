[CmdletBinding()]
param(
    [ValidateSet("helios")]
    [string]$Stack = "helios",
    [string]$InfraFile = "terraform/infra.json",
    [string]$KubeconfigPath,
    [string]$TalosconfigPath,
    [switch]$SkipConfigImport
)

begin {
    Set-StrictMode -Version Latest

    if (-not (Test-Path ".git")) {
        Write-Error "This script must be run from the repository root."
        exit 1
    }

    $script:ConfigImported = $false
    $script:RepoRoot = (Resolve-Path ".").Path

    if (-not $KubeconfigPath) {
        $KubeconfigPath = "~/.kube/orbit-$Stack.config"
    }

    if (-not $TalosconfigPath) {
        $TalosconfigPath = "~/.talos/orbit-$Stack.config"
    }

    function Resolve-UserPath {
        param(
            [Parameter(Mandatory)]
            [string]$Path
        )

        $expandedPath = [Environment]::ExpandEnvironmentVariables($Path)
        if ($expandedPath -eq "~") {
            $expandedPath = [Environment]::GetFolderPath("UserProfile")
        }
        elseif ($expandedPath.StartsWith("~/") -or $expandedPath.StartsWith("~\")) {
            $expandedPath = Join-Path ([Environment]::GetFolderPath("UserProfile")) $expandedPath.Substring(2)
        }

        if ([System.IO.Path]::IsPathRooted($expandedPath)) {
            return [System.IO.Path]::GetFullPath($expandedPath)
        }

        return [System.IO.Path]::GetFullPath((Join-Path $script:RepoRoot $expandedPath))
    }

    function Get-MissingCommandNames {
        param(
            [Parameter(Mandatory)]
            [object[]]$Commands
        )

        return @(
            foreach ($command in $Commands) {
                if (-not (Get-Command $command.Name -ErrorAction SilentlyContinue)) {
                    $command.Name
                }
            }
        )
    }

    function Convert-CommandOutputToText {
        param(
            [Parameter(ValueFromPipeline = $true)]
            $InputObject
        )

        process {
            if ($null -eq $InputObject) {
                return ""
            }

            if ($InputObject -is [System.Array]) {
                return ($InputObject -join [Environment]::NewLine)
            }

            return [string]$InputObject
        }
    }

    $requiredCommands = @(
        @{ Name = "sops"; Purpose = "decrypt terraform/infra.json for OpenTofu output access" }
        @{ Name = "tofu"; Purpose = "read kubeconfig and talosconfig from the stack outputs" }
        @{ Name = "kubectl"; Purpose = "bootstrap and operate the Kubernetes cluster" }
        @{ Name = "talosctl"; Purpose = "operate the Talos control plane" }
        @{ Name = "kustomize"; Purpose = "render Argo CD bootstrap manifests" }
        @{ Name = "helm"; Purpose = "support kustomize --enable-helm during bootstrap" }
    )

    $optionalCommands = @(
        @{ Name = "argocd"; Purpose = "inspect or manually sync Argo CD applications" }
        @{ Name = "kubeseal"; Purpose = "create or reseal SealedSecret manifests" }
        @{ Name = "yq"; Purpose = "edit SealedSecret manifests and inspect YAML quickly" }
        @{ Name = "velero"; Purpose = "trigger and inspect restore workflows" }
    )

    $resolvedInfraFile = Resolve-UserPath -Path $InfraFile
    $resolvedKubeconfigPath = Resolve-UserPath -Path $KubeconfigPath
    $resolvedTalosconfigPath = Resolve-UserPath -Path $TalosconfigPath
    $stackPath = Join-Path $script:RepoRoot "terraform/$Stack"
}

process {
    if (-not (Test-Path $stackPath)) {
        Write-Error "Terraform stack '$Stack' was not found at '$stackPath'."
        exit 1
    }

    if (-not (Test-Path $resolvedInfraFile)) {
        Write-Error "Infra file '$resolvedInfraFile' does not exist."
        exit 1
    }

    $missingRequiredCommands = @(Get-MissingCommandNames -Commands $requiredCommands)
    if ($missingRequiredCommands.Count -gt 0) {
        Write-Error ("Missing required commands: {0}" -f ($missingRequiredCommands -join ", "))
        exit 1
    }

    $missingOptionalCommands = @(Get-MissingCommandNames -Commands $optionalCommands)
    if ($missingOptionalCommands.Count -gt 0) {
        Write-Warning ("Optional day-2 commands not found: {0}" -f ($missingOptionalCommands -join ", "))
    }

    if ($SkipConfigImport) {
        return
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedKubeconfigPath) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedTalosconfigPath) -Force | Out-Null

    Push-Location $stackPath
    try {
        Write-Host "Exporting kubeconfig from terraform/$Stack..." -ForegroundColor Cyan
        $kubeconfigContent = & sops exec-file --filename "infra.json" $resolvedInfraFile "tofu output -var-file={} -raw kubeconfig"
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read kubeconfig from terraform/$Stack."
        }

        Write-Host "Exporting talosconfig from terraform/$Stack..." -ForegroundColor Cyan
        $talosconfigContent = & sops exec-file --filename "infra.json" $resolvedInfraFile "tofu output -var-file={} -raw talosconfig"
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read talosconfig from terraform/$Stack."
        }
    }
    finally {
        Pop-Location
    }

    $kubeconfigText = Convert-CommandOutputToText $kubeconfigContent
    $talosconfigText = Convert-CommandOutputToText $talosconfigContent

    if (-not $kubeconfigText) {
        Write-Error "kubeconfig output was empty."
        exit 1
    }

    if (-not $talosconfigText) {
        Write-Error "talosconfig output was empty."
        exit 1
    }

    [System.IO.File]::WriteAllText($resolvedKubeconfigPath, $kubeconfigText)
    [System.IO.File]::WriteAllText($resolvedTalosconfigPath, $talosconfigText)

    $env:KUBECONFIG = $resolvedKubeconfigPath
    $env:TALOSCONFIG = $resolvedTalosconfigPath
    $script:ConfigImported = $true
}

end {
    if ($SkipConfigImport) {
        Write-Host "Cluster-ops toolbox preflight passed." -ForegroundColor Green
        Write-Host "Run .\scripts\initialize-ClusterOps.ps1 after terraform apply to import kubeconfig and talosconfig."
        return
    }

    if ($script:ConfigImported) {
        Write-Host "Cluster-ops toolbox is ready." -ForegroundColor Green
        Write-Host "KUBECONFIG=$env:KUBECONFIG"
        Write-Host "TALOSCONFIG=$env:TALOSCONFIG"
        Write-Host "Recommended next step: .\scripts\get-ClusterOpsSnapshot.ps1 -IncludeVelero"
    }
}
