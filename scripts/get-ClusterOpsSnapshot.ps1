[CmdletBinding()]
param(
    [ValidateRange(0, 1000)]
    [int]$RestartThreshold = 3,
    [switch]$IncludeVelero
)

begin {
    Set-StrictMode -Version Latest

    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
        Write-Error "kubectl is required but not found in PATH."
        exit 1
    }

    function Write-Section {
        param(
            [Parameter(Mandatory)]
            [string]$Title
        )

        Write-Host ""
        Write-Host "== $Title ==" -ForegroundColor Cyan
    }

    function Test-ApiResource {
        param(
            [Parameter(Mandatory)]
            [string]$Name,
            [string]$ApiGroup
        )

        $resources = kubectl api-resources --api-group $ApiGroup -o name 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $resources) {
            return $false
        }

        return $resources -contains $Name
    }
}

process {
    Write-Section -Title "kubectl context"
    kubectl config current-context

    Write-Section -Title "nodes"
    kubectl get nodes -o wide

    Write-Section -Title "Argo CD applications"
    if (Test-ApiResource -Name "applications" -ApiGroup "argoproj.io") {
        kubectl get applications -n argocd
    }
    else {
        Write-Host "Argo CD applications CRD not found yet." -ForegroundColor Yellow
    }

    Write-Section -Title "pod health"
    try {
        $pods = kubectl get pods -A -o json | ConvertFrom-Json
        $unhealthyPods = @(
            foreach ($pod in $pods.items) {
                $containerStatuses = @($pod.status.containerStatuses | Where-Object { $null -ne $_ })
                $totalContainers = $containerStatuses.Count
                $readyContainers = @($containerStatuses | Where-Object { $_.ready }).Count
                $restartCount = if ($totalContainers -gt 0) {
                    [int](($containerStatuses | Measure-Object -Property restartCount -Sum).Sum)
                }
                else {
                    0
                }

                $readySummary = if ($totalContainers -gt 0) {
                    "$readyContainers/$totalContainers"
                }
                else {
                    "-"
                }

                $phase = [string]$pod.status.phase
                $isHealthy = ($phase -in @("Running", "Succeeded")) -and
                    (($totalContainers -eq 0) -or ($readyContainers -eq $totalContainers)) -and
                    ($restartCount -lt $RestartThreshold)

                if (-not $isHealthy) {
                    [pscustomobject]@{
                        Namespace = $pod.metadata.namespace
                        Name      = $pod.metadata.name
                        Phase     = $phase
                        Ready     = $readySummary
                        Restarts  = $restartCount
                        Node      = $pod.spec.nodeName
                    }
                }
            }
        )

        if ($unhealthyPods.Count -eq 0) {
            Write-Host ("No pods exceeded the restart threshold ({0}) or reported unhealthy state." -f $RestartThreshold) -ForegroundColor Green
        }
        else {
            $unhealthyPods |
                Sort-Object Namespace, Name |
                Format-Table -AutoSize
        }
    }
    catch {
        Write-Warning ("Unable to inspect pod health: {0}" -f $_.Exception.Message)
    }

    if ($IncludeVelero) {
        Write-Section -Title "Velero schedules"
        if (Test-ApiResource -Name "schedules" -ApiGroup "velero.io") {
            kubectl get schedules.velero.io -n velero
        }
        else {
            Write-Host "Velero schedules CRD not found yet." -ForegroundColor Yellow
        }

        Write-Section -Title "Velero backups"
        if (Test-ApiResource -Name "backups" -ApiGroup "velero.io") {
            kubectl get backups.velero.io -n velero
        }
        else {
            Write-Host "Velero backups CRD not found yet." -ForegroundColor Yellow
        }
    }
}
