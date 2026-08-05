import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  configurationEntries,
  findBlockingArkadiaProcesses,
  makeLocalUpdatePaths,
  makeConfigurationSyncPlan,
  makeLocalBuildVersion,
  parseLocalUpdateArgs,
  runLocalArkadiaUpdate,
  synchronizeConfiguration,
  type LocalUpdateOperations,
} from "./update-local-arkadia.ts";

describe("local Arkadia update workflow", () => {
  it("creates a unique local prerelease version without changing the base package version", () => {
    expect(makeLocalBuildVersion("0.0.31", new Date(2026, 7, 5, 23, 15, 42))).toBe(
      "0.0.31-local.20260805.231542",
    );
  });

  it("synchronizes only the explicit configuration allowlist", () => {
    expect(configurationEntries).toEqual([
      { name: "settings.json", kind: "file" },
      { name: "client-settings.json", kind: "file" },
      { name: "desktop-settings.json", kind: "file" },
      { name: "keybindings.json", kind: "file" },
      { name: "secrets", kind: "directory" },
    ]);

    const plan = makeConfigurationSyncPlan(
      String.raw`C:\Users\TRINITX\.arkadia\dev`,
      String.raw`C:\Users\TRINITX\.arkadia\userdata`,
      String.raw`C:\Users\TRINITX\.arkadia\backups\production-config-20260805-211542`,
    );

    expect(plan.map((entry) => entry.source)).toEqual([
      String.raw`C:\Users\TRINITX\.arkadia\dev\settings.json`,
      String.raw`C:\Users\TRINITX\.arkadia\dev\client-settings.json`,
      String.raw`C:\Users\TRINITX\.arkadia\dev\desktop-settings.json`,
      String.raw`C:\Users\TRINITX\.arkadia\dev\keybindings.json`,
      String.raw`C:\Users\TRINITX\.arkadia\dev\secrets`,
    ]);
    expect(plan.every((entry) => !entry.source.includes("state.sqlite"))).toBe(true);
    expect(plan.every((entry) => !entry.source.includes("attachments"))).toBe(true);
    expect(plan.every((entry) => !entry.source.includes("logs"))).toBe(true);
  });

  it("blocks installed, development Electron, and any other Arkadia executable", () => {
    const installedExecutablePath = String.raw`C:\Users\TRINITX\AppData\Local\Programs\t3code\Arkadia.exe`;
    const developmentElectronPath = String.raw`C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next\node_modules\electron\dist\electron.exe`;
    const processes = [
      { pid: 10, executablePath: installedExecutablePath.toUpperCase() },
      { pid: 11, executablePath: developmentElectronPath },
      {
        pid: 12,
        executablePath: String.raw`C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia\target\release\arkadia.exe`,
      },
      { pid: 13, executablePath: null },
    ];

    expect(
      findBlockingArkadiaProcesses(processes, {
        installedExecutablePath,
        developmentElectronPath,
        developmentServerPid: 99,
      }).map((process) => process.pid),
    ).toEqual([10, 11, 12]);
  });

  it("also blocks the exact development server pid recorded by the runtime", () => {
    expect(
      findBlockingArkadiaProcesses(
        [
          { pid: 28572, executablePath: String.raw`C:\Program Files\nodejs\node.exe` },
          { pid: 10, executablePath: String.raw`C:\Program Files\nodejs\node.exe` },
        ],
        {
          installedExecutablePath: String.raw`C:\installed\Arkadia.exe`,
          developmentElectronPath: String.raw`C:\repo\electron.exe`,
          developmentServerPid: 28572,
        },
      ).map((process) => process.pid),
    ).toEqual([28572]);
  });

  it("parses supported CLI modes and rejects unknown arguments", () => {
    expect(parseLocalUpdateArgs([])).toEqual({ syncOnly: false, dryRun: false });
    expect(parseLocalUpdateArgs(["--sync-only"])).toEqual({ syncOnly: true, dryRun: false });
    expect(parseLocalUpdateArgs(["--dry-run"])).toEqual({ syncOnly: false, dryRun: true });
    expect(() => parseLocalUpdateArgs(["--wat"])).toThrow("Argument inconnu");
  });

  it("derives stable development, production, installer and runtime paths", () => {
    expect(
      makeLocalUpdatePaths(
        String.raw`C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next`,
        String.raw`C:\Users\TRINITX`,
        String.raw`C:\Users\TRINITX\AppData\Local`,
      ),
    ).toEqual({
      repositoryRoot: String.raw`C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next`,
      developmentDirectory: String.raw`C:\Users\TRINITX\.arkadia\dev`,
      productionDirectory: String.raw`C:\Users\TRINITX\.arkadia\userdata`,
      backupRoot: String.raw`C:\Users\TRINITX\.arkadia\backups`,
      installedExecutablePath: String.raw`C:\Users\TRINITX\AppData\Local\Programs\t3code\Arkadia.exe`,
      developmentElectronPath: String.raw`C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next\apps\desktop\node_modules\electron\dist\electron.exe`,
      developmentRuntimePath: String.raw`C:\Users\TRINITX\.arkadia\dev\server-runtime.json`,
    });
  });

  it("backs up production configuration before replacing it without touching production state", async () => {
    const root = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "arkadia-config-sync-"));
    const developmentDirectory = NodePath.join(root, "dev");
    const productionDirectory = NodePath.join(root, "userdata");
    const backupRoot = NodePath.join(root, "backups");
    await NodeFs.mkdir(NodePath.join(developmentDirectory, "secrets"), { recursive: true });
    await NodeFs.mkdir(NodePath.join(productionDirectory, "secrets"), { recursive: true });
    await NodeFs.writeFile(NodePath.join(developmentDirectory, "settings.json"), "dev-settings");
    await NodeFs.writeFile(
      NodePath.join(developmentDirectory, "client-settings.json"),
      "dev-client",
    );
    await NodeFs.writeFile(NodePath.join(developmentDirectory, "secrets", "kimi"), "dev-secret");
    await NodeFs.writeFile(NodePath.join(productionDirectory, "settings.json"), "prod-settings");
    await NodeFs.writeFile(NodePath.join(productionDirectory, "state.sqlite"), "prod-history");
    await NodeFs.writeFile(
      NodePath.join(productionDirectory, "secrets", "production-only"),
      "keep",
    );

    const result = await synchronizeConfiguration({
      developmentDirectory,
      productionDirectory,
      backupRoot,
      now: new Date("2026-08-05T21:15:42.000Z"),
    });

    expect(await NodeFs.readFile(NodePath.join(productionDirectory, "settings.json"), "utf8")).toBe(
      "dev-settings",
    );
    expect(
      await NodeFs.readFile(NodePath.join(result.backupDirectory, "settings.json"), "utf8"),
    ).toBe("prod-settings");
    expect(await NodeFs.readFile(NodePath.join(productionDirectory, "state.sqlite"), "utf8")).toBe(
      "prod-history",
    );
    expect(
      await NodeFs.readFile(
        NodePath.join(productionDirectory, "secrets", "production-only"),
        "utf8",
      ),
    ).toBe("keep");
    expect(
      await NodeFs.readFile(NodePath.join(productionDirectory, "secrets", "kimi"), "utf8"),
    ).toBe("dev-secret");
  });

  it("aborts before synchronization when an exact Arkadia process is running", async () => {
    const actions: string[] = [];
    const installedExecutablePath = String.raw`C:\Users\TRINITX\AppData\Local\Programs\t3code\Arkadia.exe`;
    const operations: LocalUpdateOperations = {
      listProcesses: async () => [{ pid: 42, executablePath: installedExecutablePath }],
      synchronize: async () => {
        actions.push("sync");
        return { backupDirectory: "backup" };
      },
      build: async () => {
        actions.push("build");
        return "installer.exe";
      },
      install: async () => {
        actions.push("install");
      },
      restart: async () => {
        actions.push("restart");
      },
    };

    await expect(
      runLocalArkadiaUpdate(
        {
          baseVersion: "0.0.31",
          now: new Date(2026, 7, 5, 23, 15, 42),
          syncOnly: false,
          blockingPaths: {
            installedExecutablePath,
            developmentElectronPath: String.raw`C:\repo\node_modules\electron\electron.exe`,
          },
        },
        operations,
      ),
    ).rejects.toThrow("Fermez Arkadia");
    expect(actions).toEqual([]);
  });

  it("synchronizes, builds, installs, then restarts in order", async () => {
    const actions: string[] = [];
    const operations: LocalUpdateOperations = {
      listProcesses: async () => [],
      synchronize: async () => {
        actions.push("sync");
        return { backupDirectory: "backup" };
      },
      build: async (version) => {
        actions.push(`build:${version}`);
        return "installer.exe";
      },
      install: async (installerPath) => {
        actions.push(`install:${installerPath}`);
      },
      restart: async () => {
        actions.push("restart");
      },
    };

    const result = await runLocalArkadiaUpdate(
      {
        baseVersion: "0.0.31",
        now: new Date(2026, 7, 5, 23, 15, 42),
        syncOnly: false,
        blockingPaths: {
          installedExecutablePath: String.raw`C:\installed\Arkadia.exe`,
          developmentElectronPath: String.raw`C:\repo\electron.exe`,
        },
      },
      operations,
    );

    expect(actions).toEqual([
      "sync",
      "build:0.0.31-local.20260805.231542",
      "install:installer.exe",
      "restart",
    ]);
    expect(result).toEqual({
      backupDirectory: "backup",
      version: "0.0.31-local.20260805.231542",
      installerPath: "installer.exe",
    });
  });
});
