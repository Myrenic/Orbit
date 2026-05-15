# Cluster Ops Toolbox

Orbit is easiest to operate from a dedicated admin workstation shell with the cluster CLI toolchain already installed and the `helios` kubeconfig/talosconfig loaded.

## Required CLI tools

These tools are required for the repo's bootstrap and day-2 workflows:

| Tool | Why Orbit needs it |
| --- | --- |
| `sops` | Decrypts `terraform/infra.json` so Terraform outputs can be read safely. |
| `tofu` | Reads the `helios` kubeconfig and talosconfig outputs. |
| `kubectl` | Applies bootstrap manifests and runs day-2 Kubernetes operations. |
| `talosctl` | Talks to the Talos control plane for node-level operations. |
| `kustomize` | Renders the Argo CD bootstrap manifests. |
| `helm` | Required by `kustomize --enable-helm` during bootstrap. |

Optional but recommended:

| Tool | Why it helps |
| --- | --- |
| `argocd` | Manual syncs and Argo CD troubleshooting. |
| `kubeseal` | Creates and re-seals Sealed Secrets. |
| `yq` | Supports the sealed-secret editing flow and quick manifest inspection. |
| `velero` | Restore workflows and backup inspection. |

See also: [`storage-dr.md`](./storage-dr.md) for the Longhorn replica policy, Velero backup expectations, and the restore drill flow.

## Quick start

1. Install the required CLI tools on your admin workstation.
2. From the repo root, validate that the toolchain is present:

   ```powershell
   .\scripts\initialize-ClusterOps.ps1 -SkipConfigImport
   ```

3. After `terraform/helios` has been applied, import dedicated config files for this cluster:

   ```powershell
   .\scripts\initialize-ClusterOps.ps1
   ```

   This writes:

   - `~/.kube/orbit-helios.config`
   - `~/.talos/orbit-helios.config`

   The script also exports `KUBECONFIG` and `TALOSCONFIG` for the current shell so the rest of the repo scripts use the right cluster context.

4. Capture a day-2 snapshot:

   ```powershell
   .\scripts\get-ClusterOpsSnapshot.ps1 -IncludeVelero
   ```

## Common operator flows

| Task | Command |
| --- | --- |
| Bootstrap the repo-managed namespaces and Argo CD | `.\scripts\new-Cluster.ps1` |
| Restore from the latest Velero schedule during onboarding | `.\scripts\new-Cluster.ps1 -RestoreVelero -VeleroSchedule daily` |
| Fetch the initial Argo CD admin password | `.\scripts\get-ArgoPassword.ps1` |
| Back up the active Sealed Secrets keypair | `.\scripts\backup-SealedSecret.ps1` |
| Re-seal an existing Sealed Secret manifest | `.\scripts\edit-SealedSecret.ps1 -FilePath <path>` |

- `.\scripts\new-Cluster.ps1` now seeds `argocd/argocd-sops-age-key` from the repo-root `age.agekey` bootstrap material before Argo CD is applied, so repo-managed SOPS content can decrypt on first sync without a manual secret step.

## Monitoring

- Grafana is exposed at `https://grafana.<shared-domain>` through the shared `network/oauth2-proxy-auth` middleware.
- Retrieve the initial Grafana admin password with:

  ```bash
  kubectl -n monitoring get secret kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d
  ```

- Orbit also emits operator-focused alerts for Traefik availability and stale or failed Velero backups.

## Secret handling

- Use `sops` + age for shared/bootstrap material that must be rendered outside the cluster, such as `terraform/infra.json` and `kubernetes/velero/velero/velero-credentials.sops.yaml`.
- Use Sealed Secrets for application-facing Kubernetes secrets that should stay GitOps-native after bootstrap.
- Orbit does not currently deploy External Secrets controllers or CRDs; avoid introducing a third secret workflow unless the repository is updated end-to-end.
