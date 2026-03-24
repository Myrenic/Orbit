[CmdletBinding()]
param(
    [string]$BackupName,
    [string]$ScheduleName = "daily",
    [string]$RestoreName,
    [switch]$Wait
)

Begin {
    if (-not (Get-Command velero -ErrorAction SilentlyContinue)) {
        Write-Error "Velero CLI not found. Install velero before running this script."
        exit 1
    }

    $script:RestoreSucceeded = $false
    $script:RestoreName = $null
    $script:RestoreStatus = $null
}

Process {
    if (-not $BackupName) {
        $backupResponse = velero backup get -o json | ConvertFrom-Json

        $candidates = $backupResponse.items | Where-Object {
            $_.status.phase -eq "Completed"
        }

        if ($ScheduleName) {
            $candidates = $candidates | Where-Object {
                $_.metadata.labels."velero.io/schedule-name" -eq $ScheduleName
            }
        }

        $selectedBackup = $candidates | Sort-Object {
            if ($_.status.startTimestamp) {
                [datetime]$_.status.startTimestamp
            } else {
                [datetime]$_.metadata.creationTimestamp
            }
        } -Descending | Select-Object -First 1

        if (-not $selectedBackup) {
            $scheduleMessage = if ($ScheduleName) { " for schedule '$ScheduleName'" } else { "" }
            Write-Error "No completed backups found$scheduleMessage."
            exit 1
        }

        $BackupName = $selectedBackup.metadata.name
    }

    if (-not $RestoreName) {
        $RestoreName = "onboarding-restore-{0}" -f (Get-Date -Format "yyyyMMddHHmmss")
    }

    $script:RestoreName = $RestoreName

    $restoreArgs = @("restore", "create", $RestoreName, "--from-backup", $BackupName)
    if ($Wait) {
        $restoreArgs += "--wait"
    }

    velero @restoreArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Velero restore failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }

    $script:RestoreSucceeded = $true

    $restoreDetails = velero restore get $RestoreName -o json | ConvertFrom-Json
    if ($LASTEXITCODE -eq 0 -and $restoreDetails) {
        $script:RestoreStatus = $restoreDetails.status.phase
    }
}

End {
    if ($script:RestoreSucceeded) {
        if ($script:RestoreStatus) {
            Write-Host "Restore '$script:RestoreName' initiated from backup '$BackupName' (phase: $script:RestoreStatus)." -ForegroundColor Green
        } else {
            Write-Host "Restore '$script:RestoreName' initiated from backup '$BackupName'." -ForegroundColor Green
        }
    }
}
