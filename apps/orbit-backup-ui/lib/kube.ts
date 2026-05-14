import * as k8s from "@kubernetes/client-node";

type KubeClients = {
  apps: k8s.AppsV1Api;
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
