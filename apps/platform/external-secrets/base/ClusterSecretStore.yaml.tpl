apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: bitwarden-cluster-secretsmanager
  annotations:
    argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true
spec:
  provider:
    bitwardensecretsmanager:
      apiURL: https://api.bitwarden.com
      identityURL: https://identity.bitwarden.com
      auth:
        secretRef:
          credentials:
            key: token
            name: bitwarden-api-tokens
            namespace: external-secrets
      bitwardenServerSDKURL: https://bitwarden-sdk-server.external-secrets.svc.cluster.local:9998
      caProvider:
        type: Secret
        name: bitwarden-tls-certs
        namespace: external-secrets
        key: tls.crt
      organizationID: "${BW_ORGANIZATION_ID}"
      projectID: "${BW_PROJECT_ID}"
