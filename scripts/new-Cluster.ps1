
[CmdletBinding()]
param(
    [switch]$RestoreVelero,
    [string]$VeleroSchedule = "daily"
)



begin {
    if (-not (Test-Path ".git")) {
        Write-Error "This script must be run from the repository root."
        exit 1
    }

    $SCRIPT_DIR = $PSScriptRoot

    # helper functions
    function Wait-ForDeploymentReady {
        param(
            [string]$Name,
            [string]$Namespace = "default",
            [int]$TimeoutSeconds = 300
        )

        $startTime = Get-Date
        while ($true) {
            $status = kubectl get deployment $Name -n $Namespace -o json 2>$null
            if ($status) {
                $readyReplicas = ($status | ConvertFrom-Json).status.readyReplicas
                $replicas = ($status | ConvertFrom-Json).status.replicas
                if ($readyReplicas -eq $replicas -and $replicas -gt 0) { break }
            }

            if ((Get-Date) - $startTime -gt (New-TimeSpan -Seconds $TimeoutSeconds)) {
                Write-Warning "Timeout waiting for deployment $Name in $Namespace"
                break
            }
            Start-Sleep -Seconds 5
        }
    }


    # Input list, in order of execution
    $rawItems = @(
        "namespace:secrets",
        "namespace:argocd",

        "yaml:sealed-secret-backup.yaml",

        "chart:kubernetes/argocd/argocd",
        "chart:kubernetes/argocd/argocd-apps"
    )

    # Convert entries into structured objects
    $items = foreach ($entry in $rawItems) {
        $type, $value = $entry -split ":", 2

        [pscustomobject]@{
            Type  = $type
            Value = $value
        }
    }
}

process {
    foreach ($item in $items) {
        switch ($item.Type) {

            "namespace" {
                Write-Host "Creating namespace: $($item.Value)..." -ForegroundColor Cyan
                kubectl create namespace $item.Value --dry-run=client -o yaml |
                    kubectl apply -f -
            }

            "yaml" {
                Write-Host "Applying yaml: $($item.Value)..." -ForegroundColor Cyan
		kubectl apply -f $item.Value --server-side --force-conflicts
            }

	    "chart" {
                Write-Host "Applying chart: $($item.Value)..." -ForegroundColor Cyan
                kustomize build $item.Value --enable-helm | kubectl apply -f - --server-side
                
                if ($item.Value -match "argocd$") {
                    Write-Host "Waiting for ArgoCD CRDs to settle..." -ForegroundColor Yellow
                    Start-Sleep -Seconds 15 
                }
	     }
            default {
                Write-Warning "Unknown item type: $($item.Type)"
            }
        }
    }
}

end {
    Write-Host "All resources processed successfully." -ForegroundColor Green

    if ($RestoreVelero) {
        Write-Host "Waiting for Velero to become ready..." -ForegroundColor Yellow
        Wait-ForDeploymentReady -Name "velero" -Namespace "velero" -TimeoutSeconds 600

        $restoreScript = Join-Path $SCRIPT_DIR "restore-Velero.ps1"
        if (-not (Test-Path $restoreScript)) {
            Write-Error "Velero restore script not found at $restoreScript"
            exit 1
        }

        & $restoreScript -ScheduleName $VeleroSchedule -Wait
    }
}
