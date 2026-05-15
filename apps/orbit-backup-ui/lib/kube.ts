import * as k8s from "@kubernetes/client-node";

type KubeClients = {
  apps: k8s.AppsV1Api;
  batch: k8s.BatchV1Api;
  core: k8s.CoreV1Api;
  customObjects: k8s.CustomObjectsApi;
};

declare global {
  var __orbitBackupKubeClients: KubeClients | undefined;
}

export function getKubeClients(): KubeClients {
  if (globalThis.__orbitBackupKubeClients) {
    return globalThis.__orbitBackupKubeClients;
  }

  const kubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromDefault();

  const clients: KubeClients = {
    apps: kubeConfig.makeApiClient(k8s.AppsV1Api),
    batch: kubeConfig.makeApiClient(k8s.BatchV1Api),
    core: kubeConfig.makeApiClient(k8s.CoreV1Api),
    customObjects: kubeConfig.makeApiClient(k8s.CustomObjectsApi),
  };

  globalThis.__orbitBackupKubeClients = clients;
  return clients;
}

export function getLonghornNamespace() {
  return process.env.LONGHORN_NAMESPACE || "storage";
}

export function getExcludedNamespaces() {
  return new Set(
    (process.env.ORBIT_BACKUP_EXCLUDED_NAMESPACES ||
      "kube-system,kube-public,kube-node-lease")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function getNumericErrorCode(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function getKubernetesErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const value = error as {
    body?: { code?: unknown };
    code?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
    statusCode?: unknown;
  };

  return (
    getNumericErrorCode(value.code) ??
    getNumericErrorCode(value.statusCode) ??
    getNumericErrorCode(value.response?.status) ??
    getNumericErrorCode(value.response?.statusCode) ??
    getNumericErrorCode(value.body?.code)
  );
}

export function isKubernetesErrorStatus(error: unknown, status: number) {
  return getKubernetesErrorStatus(error) === status;
}
