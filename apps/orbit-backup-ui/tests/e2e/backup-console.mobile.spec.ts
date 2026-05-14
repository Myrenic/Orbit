import { expect, test, type Page } from "@playwright/test";

const viewport = { width: 414, height: 896 };

const dashboardResponse = {
  user: {
    email: "homelab.operator.with.a.very.long.email.address@orbit.example.internal",
    groups: ["admins"],
  },
  overview: {
    workloadCount: 4,
    protectedWorkloadCount: 1,
    backupSetCount: 1,
    runningOperations: 1,
    targetHealthy: true,
  },
  recentOperations: [],
  schedules: [
    {
      id: "nightly-long-retention-policy",
      name: "Nightly Aiostreams Protection Run",
      cron: "0 2 * * *",
      retain: 14,
      enabled: true,
      appRefs: ["services/Deployment/aiostreams"],
      appDisplayNames: ["Aiostreams"],
      activeAppRefs: ["services/Deployment/aiostreams"],
      activeVolumeCount: 1,
      backend: "longhorn-recurringjob",
      nextRunAt: "2026-05-15T02:00:00.000Z",
      lastRunAt: "2026-05-14T02:00:00.000Z",
      createdAt: "2026-05-01T02:00:00.000Z",
      updatedAt: "2026-05-14T02:00:00.000Z",
    },
  ],
  targets: [
    {
      name: "default",
      backupTargetURL:
        "azblob://longhorn-primary-backups-with-an-intentionally-long-container-name@core.windows.net/very/long/prefix/that/used/to/stretch/mobile/cards",
      credentialSecret: "azure-backup-credentials",
      pollInterval: "300s",
      available: true,
      lastSyncedAt: "2026-05-14T15:02:00.000Z",
      conditions: [],
    },
  ],
};

const appsResponse = {
  apps: [
    {
      ref: "services/Deployment/aiostreams",
      namespace: "services",
      kind: "Deployment",
      name: "aiostreams",
      displayName: "Aiostreams",
      status: "healthy",
      podCount: 1,
      readyPodCount: 1,
      podNames: ["aiostreams-7b8df48f7b-x2z9k"],
      pods: [
        {
          name: "aiostreams-7b8df48f7b-x2z9k",
          phase: "Running",
          ready: true,
          restarts: 0,
        },
      ],
      claimNames: ["aiostreams-data-primary"],
      volumes: [
        {
          pvcName:
            "aiostreams-persistent-application-data-volume-name-that-should-wrap-cleanly-on-mobile-without-stretching-the-card",
          longhornVolumeName: "pvc-long-volume-name",
          size: "50Gi",
          accessModes: ["ReadWriteOnce"],
          lastBackupAt: "2026-05-14T12:30:00.000Z",
        },
      ],
    },
  ],
  unmanagedItems: [
    {
      ref: "services/Deployment/manual-test-pod",
      namespace: "services",
      kind: "Deployment",
      name: "manual-test-pod",
      displayName: "Manual test pod",
      confidence: "high",
      source: "restore-artifact",
      createdAt: "2026-05-14T11:00:00.000Z",
      managementSummary: "Leftover validation deployment not owned by Argo CD.",
      reasons: [
        {
          summary: "No Argo application owner",
          detail: "Detected after a restore validation run and safe to clean up.",
        },
      ],
      podCount: 0,
      readyPodCount: 0,
      pods: [],
    },
  ],
};

const backupSetsResponse = {
  backupSets: [
    {
      id: "backup-set-aiostreams-20260514",
      displayName: "Aiostreams backup 2026-05-14",
      namespace: "services",
      workloadKind: "Deployment",
      workloadName: "aiostreams",
      currentAppRef: "services/Deployment/aiostreams",
      createdAt: "2026-05-14T12:30:00.000Z",
      state: "Completed",
      volumeCount: 1,
      requestedBy: "operator.with.a.very.long.identity@orbit.example.internal",
      podCount: 1,
      readyPodCount: 1,
      podNames: ["aiostreams-7b8df48f7b-x2z9k"],
      pods: [
        {
          name: "aiostreams-7b8df48f7b-x2z9k",
          phase: "Running",
          ready: true,
          restarts: 0,
        },
      ],
      cloneRestoreSupported: true,
      volumes: [
        {
          name: "backup-volume-aiostreams",
          setId: "backup-set-aiostreams-20260514",
          volumeName:
            "pvc-aiostreams-persistent-application-data-volume-name-that-should-wrap-cleanly-on-mobile",
          pvcName:
            "aiostreams-persistent-application-data-volume-name-that-should-wrap-cleanly-on-mobile",
          namespace: "services",
          workloadKind: "Deployment",
          workloadName: "aiostreams",
          appDisplayName: "Aiostreams",
          currentAppRef: "services/Deployment/aiostreams",
          createdAt: "2026-05-14T12:30:00.000Z",
          state: "Completed",
          progress: 100,
          requestedBy: "operator",
          labels: {},
        },
      ],
    },
  ],
};

const operationsResponse = {
  operations: [
    {
      id: "restore-aiostreams-long-error",
      type: "restore",
      status: "failed",
      mode: "in-place",
      requestedBy: "operator.with.a.very.long.identity@orbit.example.internal",
      createdAt: "2026-05-14T12:45:00.000Z",
      finishedAt: "2026-05-14T12:47:00.000Z",
      summary: "Restore Aiostreams from the latest backup",
      items: [
        {
          id: "restore-aiostreams-item",
          displayName: "Aiostreams",
          namespace: "services",
          kind: "Deployment",
          resourceName: "aiostreams",
          appRef: "services/Deployment/aiostreams",
          backupSetId: "backup-set-aiostreams-20260514",
          status: "failed",
          progress: 67,
          message:
            'services/Deployment/aiostreams HTTP-Code: 404 Message: Unknown API Status Code! Body: {"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"namespaces \\"services-restore\\" not found","reason":"NotFound","details":{"name":"services-restore","kind":"namespaces"},"code":404}',
          logs: [
            {
              timestamp: "2026-05-14T12:45:10.000Z",
              level: "info",
              message: "Scaling workload down and pausing Argo reconciliation.",
            },
            {
              timestamp: "2026-05-14T12:46:15.000Z",
              level: "error",
              message:
                'services/Deployment/aiostreams HTTP-Code: 404 Message: Unknown API Status Code! Body: {"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"namespaces \\"services-restore\\" not found","reason":"NotFound","details":{"name":"services-restore","kind":"namespaces"},"code":404}',
            },
          ],
          volumes: [
            {
              volumeName:
                "pvc-aiostreams-persistent-application-data-volume-name-that-should-wrap-cleanly-on-mobile",
              pvcName:
                "aiostreams-persistent-application-data-volume-name-that-should-wrap-cleanly-on-mobile",
              snapshotName:
                "snapshot-aiostreams-2026-05-14-with-a-very-long-longhorn-snapshot-name-for-overflow-testing",
              backupName:
                "backup-aiostreams-2026-05-14-with-a-very-long-longhorn-backup-name-for-overflow-testing",
              restoredClaimName:
                "aiostreams-restore-claim-with-a-very-long-name-to-confirm-safe-wrapping",
              restoredNamespace: "services-restore",
              progress: 67,
              status: "failed",
              message:
                'Volume restore failed while applying restore metadata for pvc-aiostreams-persistent-application-data-volume-name-that-should-wrap-cleanly-on-mobile.',
            },
          ],
        },
      ],
    },
  ],
};

const pbsResponse = {
  pbs: {
    enabled: true,
    configured: true,
    reachable: true,
    server: "10.0.69.254",
    datastore: "backups",
    username: "root@pam",
    fingerprint: "fingerprint",
    backupId: "orbit-backup-ui",
    keepLast: 7,
    archiveOnBackup: true,
    snapshots: [],
  },
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());

    if (route.request().method() !== "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    const payload =
      pathname === "/api/dashboard"
        ? dashboardResponse
        : pathname === "/api/apps"
          ? appsResponse
          : pathname === "/api/backups"
            ? backupSetsResponse
            : pathname === "/api/operations"
              ? operationsResponse
              : pathname === "/api/pbs"
                ? pbsResponse
                : pathname === "/api/destinations"
                  ? { longhornEnabled: true }
                  : { ok: true };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

async function getOverflowState(page: Page) {
  return page.evaluate(() => {
    const tolerance = 1;
    const viewportWidth = window.innerWidth;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return null;
        }

        const rightOverflow = Math.round((rect.right - viewportWidth) * 100) / 100;
        const leftOverflow = Math.round(Math.abs(Math.min(rect.left, 0)) * 100) / 100;
        if (rightOverflow <= tolerance && leftOverflow <= tolerance) {
          return null;
        }

        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
          rightOverflow,
          leftOverflow,
          width: Math.round(rect.width * 100) / 100,
        };
      })
      .filter(Boolean);

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
    };
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await getOverflowState(page);
  const message = JSON.stringify(overflow, null, 2);

  expect(overflow.documentWidth, message).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  expect(overflow.bodyWidth, message).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  expect(overflow.offenders, message).toEqual([]);
}

async function expectCardsToFillContainer(
  page: Page,
  cardTestIds: string[],
) {
  const cardBoxes = await Promise.all(
    cardTestIds.map((cardTestId) => page.getByTestId(cardTestId).boundingBox()),
  );
  const [firstCardBox] = cardBoxes;
  expect(firstCardBox).not.toBeNull();

  for (const cardBox of cardBoxes) {
    expect(cardBox).not.toBeNull();
    expect(cardBox!.x).toBeCloseTo(firstCardBox!.x, 0);
    expect(cardBox!.width).toBeCloseTo(firstCardBox!.width, 0);
    expect(cardBox!.width).toBeGreaterThan(viewport.width * 0.75);
  }
}

test.use({
  viewport,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("backup page stays full width on mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-backup").click({ force: true });
  await expect(page.getByRole("heading", { name: "Protect workloads" })).toBeVisible();
  await expectCardsToFillContainer(page, ["backup-mode-card", "backup-summary-card"]);
  await expectNoHorizontalOverflow(page);
});

test("restore page stays full width on mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-restore").click({ force: true });
  await expect(page.getByRole("heading", { name: "Recover apps from the backup catalog" })).toBeVisible();
  await expectCardsToFillContainer(page, ["restore-mode-card", "restore-summary-card"]);
  await expectNoHorizontalOverflow(page);
});

test("activity page wraps long restore errors on mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-activity").click({ force: true });
  await expect(page.getByRole("heading", { name: "Runs and progress" })).toBeVisible();
  await page.locator("summary").first().click();
  await expectNoHorizontalOverflow(page);
});
