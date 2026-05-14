import {
  getKubeClients,
  getLonghornNamespace,
  isKubernetesErrorStatus,
} from "@/lib/kube";

export type LonghornObject = {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp?: string;
    resourceVersion?: string;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
};

const GROUP = "longhorn.io";
const VERSION = "v1beta2";

export function getLonghornObjectNamespace() {
  return getLonghornNamespace();
}

export async function listLonghornObjects(plural: string) {
  const response = await getKubeClients().customObjects.listNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace: getLonghornObjectNamespace(),
    plural,
  });

  return (response.items ?? []) as LonghornObject[];
}

export async function getLonghornObject(plural: string, name: string) {
  try {
    return (await getKubeClients().customObjects.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: getLonghornObjectNamespace(),
      plural,
      name,
    })) as LonghornObject;
  } catch (error) {
    if (isKubernetesErrorStatus(error, 404)) {
      return undefined;
    }
    throw error;
  }
}

export async function createLonghornObject(body: LonghornObject, plural: string) {
  return getKubeClients().customObjects.createNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace: getLonghornObjectNamespace(),
    plural,
    body,
  });
}

export async function replaceLonghornObject(
  plural: string,
  name: string,
  body: LonghornObject,
) {
  return getKubeClients().customObjects.replaceNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace: getLonghornObjectNamespace(),
    plural,
    name,
    body,
  });
}

export async function deleteLonghornObject(plural: string, name: string) {
  try {
    await getKubeClients().customObjects.deleteNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: getLonghornObjectNamespace(),
      plural,
      name,
      body: {},
    });
  } catch (error) {
    if (!isKubernetesErrorStatus(error, 404)) {
      throw error;
    }
  }
}

type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  onPoll?: (object: LonghornObject) => Promise<void> | void;
};

export async function waitForLonghornObject(
  plural: string,
  name: string,
  predicate: (object: LonghornObject) => boolean,
  options: WaitOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const object = await getLonghornObject(plural, name);
    if (object) {
      if (options.onPoll) {
        await options.onPoll(object);
      }
      if (predicate(object)) {
        return object;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`${plural}/${name} did not reach the expected state in time.`);
}
