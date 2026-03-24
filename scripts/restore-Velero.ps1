[CmdletBinding()]
param(
    [string]$BackupName,
    [string]$ScheduleName = "daily",
    [switch]$Wait
)

Begin {
    if (-not (Get-Command velero -ErrorAction SilentlyContinue)) {
        Write-Error "Velero CLI not found. Install velero before running this script."
        exit 1
    }

    $script:RestoreSucceeded = $false
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

    $restoreArgs = @("restore", "create", "--from-backup", $BackupName)
    if ($Wait) {
        $restoreArgs += "--wait"
    }

    velero @restoreArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Velero restore failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }

    $script:RestoreSucceeded = $true
}

End {
    if ($script:RestoreSucceeded) {
        Write-Host "Restore initiated from backup '$BackupName'." -ForegroundColor Green
    }
}
