# Storage, backup, and disaster recovery

Orbit stores Kubernetes PVCs on Longhorn and protects cluster state with Velero.

## Current defaults

- The default `longhorn` StorageClass uses **3 replicas**, matching the three Talos control-plane nodes defined for `helios` in `terraform/infra.json`.
- Velero writes backups to the Azure `default` backup storage location.
- Velero uses **Kopia filesystem backups** for pod volumes by default and keeps snapshots disabled in-chart, so Longhorn-backed PVC recovery depends on Velero pod volume backups instead of CSI snapshots.

## Day-2 validation

Run these checks from a shell that has already loaded the Orbit kubeconfig with `.\scripts\initialize-ClusterOps.ps1`.

```powershell
kubectl get storageclass longhorn -o jsonpath='{.parameters.numberOfReplicas}{"`n"}'
kubectl -n velero get backupstoragelocation
kubectl -n velero get schedules,backups,restores
velero backup get
```

Healthy signs:

- the `longhorn` StorageClass reports `3` replicas
- the Velero backup storage location is `Available`
- the `daily` schedule is present
- recent backups complete without partial failures

## Restore workflow

For onboarding or DR recovery, rehydrate the cluster GitOps control plane first and then restore the latest Velero backup for the expected schedule:

```powershell
.\scripts\new-Cluster.ps1 -RestoreVelero -VeleroSchedule daily
```

That flow waits for the Velero deployment to become ready and then calls `scripts/restore-Velero.ps1`.

After starting a restore, inspect it with:

```powershell
velero restore get
velero restore describe <restore-name> --details
kubectl get podvolumerestores -A
```

## Operational notes

- Velero server and node-agent resource requests are pinned in-repo because the Azure plugin requires explicit requests/limits.
- Kopia repository maintenance jobs also have explicit resource limits so backup pruning and integrity checks do not run unbounded during normal operations.
