// @effect-diagnostics nodeBuiltinImport:off - Standalone Node script; it runs from a .bat before any Effect runtime exists.
// @effect-diagnostics globalConsole:off - Console output is this script's user interface; there is no logger to route it through.
// @effect-diagnostics globalDate:off - Build timestamps come from the wall clock the installer filename is stamped with.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

export const configurationEntries = [
  { name: "settings.json", kind: "file" },
  { name: "client-settings.json", kind: "file" },
  { name: "desktop-settings.json", kind: "file" },
  { name: "keybindings.json", kind: "file" },
  { name: "secrets", kind: "directory" },
] as const;

export interface ConfigurationSyncPlanEntry {
  readonly name: (typeof configurationEntries)[number]["name"];
  readonly kind: (typeof configurationEntries)[number]["kind"];
  readonly source: string;
  readonly destination: string;
  readonly backup: string;
}

export interface ProcessSnapshot {
  readonly pid: number;
  readonly executablePath: string | null;
}

export interface BlockingExecutablePaths {
  readonly installedExecutablePath: string;
  readonly developmentElectronPath: string;
  readonly developmentServerPid?: number | undefined;
}

export interface LocalUpdatePaths {
  readonly repositoryRoot: string;
  readonly developmentDirectory: string;
  readonly productionDirectory: string;
  readonly backupRoot: string;
  readonly installedExecutablePath: string;
  readonly developmentElectronPath: string;
  readonly developmentRuntimePath: string;
}

export interface LocalUpdateCliArgs {
  readonly syncOnly: boolean;
  readonly dryRun: boolean;
}

export interface SynchronizeConfigurationOptions {
  readonly developmentDirectory: string;
  readonly productionDirectory: string;
  readonly backupRoot: string;
  readonly now: Date;
}

export interface SynchronizeConfigurationResult {
  readonly backupDirectory: string;
}

export interface LocalUpdateOperations {
  readonly listProcesses: () => Promise<readonly ProcessSnapshot[]>;
  readonly synchronize: () => Promise<SynchronizeConfigurationResult>;
  readonly build: (version: string) => Promise<string>;
  readonly install: (installerPath: string) => Promise<void>;
  readonly restart: () => Promise<void>;
}

export interface RunLocalArkadiaUpdateOptions {
  readonly baseVersion: string;
  readonly now: Date;
  readonly syncOnly: boolean;
  readonly blockingPaths: BlockingExecutablePaths;
}

export interface LocalArkadiaUpdateResult {
  readonly backupDirectory: string;
  readonly version: string;
  readonly installerPath: string | null;
}

function formatLocalTimestampParts(now: Date): { readonly date: string; readonly time: string } {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return {
    date: `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
}

function formatLocalTimestamp(now: Date, separator: "." | "-"): string {
  const { date, time } = formatLocalTimestampParts(now);
  return `${date}${separator}${time}`;
}

// Semver forbids leading zeros in numeric prerelease identifiers, so
// electron-builder normalizes `...local.20260808.030154` to `...30154` before
// expanding `${version}` in the artifact name. Emitting the canonical form here
// keeps the version we build, the version the app reports and the installer
// file name identical.
function stripLeadingZeros(numericIdentifier: string): string {
  return numericIdentifier.replace(/^0+(?=\d)/, "");
}

export function makeLocalBuildVersion(baseVersion: string, now: Date): string {
  const { date, time } = formatLocalTimestampParts(now);
  return `${baseVersion}-local.${date}.${stripLeadingZeros(time)}`;
}

export function parseLocalUpdateArgs(args: readonly string[]): LocalUpdateCliArgs {
  let syncOnly = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--sync-only") {
      syncOnly = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Argument inconnu : ${arg}`);
  }
  return { syncOnly, dryRun };
}

export function makeLocalUpdatePaths(
  repositoryRoot: string,
  homeDirectory: string,
  localAppDataDirectory: string,
): LocalUpdatePaths {
  const arkadiaDirectory = NodePath.win32.join(homeDirectory, ".arkadia");
  const developmentDirectory = NodePath.win32.join(arkadiaDirectory, "dev");
  return {
    repositoryRoot,
    developmentDirectory,
    productionDirectory: NodePath.win32.join(arkadiaDirectory, "userdata"),
    backupRoot: NodePath.win32.join(arkadiaDirectory, "backups"),
    installedExecutablePath: NodePath.win32.join(
      localAppDataDirectory,
      "Programs",
      "t3code",
      "Arkadia.exe",
    ),
    developmentElectronPath: NodePath.win32.join(
      repositoryRoot,
      "apps",
      "desktop",
      "node_modules",
      "electron",
      "dist",
      "electron.exe",
    ),
    developmentRuntimePath: NodePath.win32.join(developmentDirectory, "server-runtime.json"),
  };
}

export function makeConfigurationSyncPlan(
  developmentDirectory: string,
  productionDirectory: string,
  backupDirectory: string,
): readonly ConfigurationSyncPlanEntry[] {
  return configurationEntries.map((entry) => ({
    ...entry,
    source: NodePath.win32.join(developmentDirectory, entry.name),
    destination: NodePath.win32.join(productionDirectory, entry.name),
    backup: NodePath.win32.join(backupDirectory, entry.name),
  }));
}

function normalizeWindowsExecutablePath(value: string): string {
  return NodePath.win32.normalize(value).toLocaleLowerCase("en-US");
}

export function findBlockingArkadiaProcesses(
  processes: readonly ProcessSnapshot[],
  paths: BlockingExecutablePaths,
): readonly ProcessSnapshot[] {
  const blockedPaths = new Set([
    normalizeWindowsExecutablePath(paths.installedExecutablePath),
    normalizeWindowsExecutablePath(paths.developmentElectronPath),
  ]);

  // Named `snapshot`, not `process`: the parameter would otherwise shadow the
  // Node global of the same name, and every read here means "the process being
  // inspected", never "this script's own process".
  return processes.filter(
    (snapshot) =>
      snapshot.pid === paths.developmentServerPid ||
      (snapshot.executablePath !== null &&
        (blockedPaths.has(normalizeWindowsExecutablePath(snapshot.executablePath)) ||
          NodePath.win32.basename(snapshot.executablePath).toLocaleLowerCase("en-US") ===
            "arkadia.exe")),
  );
}

function makeBackupTimestamp(now: Date): string {
  return formatLocalTimestamp(now, "-");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyConfigurationEntry(
  source: string,
  destination: string,
  kind: ConfigurationSyncPlanEntry["kind"],
): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
  if (kind === "directory") {
    await NodeFSP.cp(source, destination, { recursive: true, force: true });
    return;
  }
  await NodeFSP.copyFile(source, destination);
}

export async function synchronizeConfiguration(
  options: SynchronizeConfigurationOptions,
): Promise<SynchronizeConfigurationResult> {
  const backupDirectory = NodePath.join(
    options.backupRoot,
    `production-config-${makeBackupTimestamp(options.now)}`,
  );
  const plan = makeConfigurationSyncPlan(
    options.developmentDirectory,
    options.productionDirectory,
    backupDirectory,
  );

  await NodeFSP.mkdir(options.productionDirectory, { recursive: true });
  for (const entry of plan) {
    if (!(await pathExists(entry.source))) continue;
    if (await pathExists(entry.destination)) {
      await copyConfigurationEntry(entry.destination, entry.backup, entry.kind);
    }
    await copyConfigurationEntry(entry.source, entry.destination, entry.kind);
  }

  return { backupDirectory };
}

export async function runLocalArkadiaUpdate(
  options: RunLocalArkadiaUpdateOptions,
  operations: LocalUpdateOperations,
): Promise<LocalArkadiaUpdateResult> {
  const processes = await operations.listProcesses();
  const blockers = findBlockingArkadiaProcesses(processes, options.blockingPaths);
  if (blockers.length > 0) {
    throw new Error("Fermez Arkadia et le serveur de développement avant de continuer.");
  }

  const synchronized = await operations.synchronize();
  const version = makeLocalBuildVersion(options.baseVersion, options.now);
  if (options.syncOnly) {
    return {
      backupDirectory: synchronized.backupDirectory,
      version,
      installerPath: null,
    };
  }

  const installerPath = await operations.build(version);
  await operations.install(installerPath);
  await operations.restart();
  return {
    backupDirectory: synchronized.backupDirectory,
    version,
    installerPath,
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await NodeFSP.readFile(path, "utf8")) as unknown;
}

async function readDevelopmentServerPid(runtimePath: string): Promise<number | undefined> {
  try {
    const parsed = await readJsonFile(runtimePath);
    if (typeof parsed !== "object" || parsed === null || !("pid" in parsed)) return undefined;
    const pid = (parsed as { readonly pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function resolveExistingPath(path: string): Promise<string> {
  try {
    return await NodeFSP.realpath(path);
  } catch {
    return path;
  }
}

async function listWindowsProcesses(): Promise<readonly ProcessSnapshot[]> {
  const command = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$items = Get-Process | ForEach-Object {",
    "  try { [pscustomobject]@{ pid = $_.Id; executablePath = $_.Path } } catch {}",
    "}",
    "@($items) | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): ProcessSnapshot[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as { readonly pid?: unknown; readonly executablePath?: unknown };
    if (typeof candidate.pid !== "number") return [];
    return [
      {
        pid: candidate.pid,
        executablePath:
          typeof candidate.executablePath === "string" ? candidate.executablePath : null,
      },
    ];
  });
}

async function runVisibleCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
  } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `La commande ${command} a échoué (${signal === null ? `code ${code}` : `signal ${signal}`}).`,
        ),
      );
    });
  });
}

async function readBaseVersion(repositoryRoot: string): Promise<string> {
  const manifest = await readJsonFile(
    NodePath.join(repositoryRoot, "apps", "server", "package.json"),
  );
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error("La version d'Arkadia est introuvable dans apps/server/package.json.");
  }
  const version = (manifest as { readonly version?: unknown }).version;
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error("La version d'Arkadia est invalide dans apps/server/package.json.");
  }
  return version;
}

function makeRealOperations(input: {
  readonly paths: LocalUpdatePaths;
  readonly now: Date;
}): LocalUpdateOperations {
  return {
    listProcesses: listWindowsProcesses,
    synchronize: () =>
      synchronizeConfiguration({
        developmentDirectory: input.paths.developmentDirectory,
        productionDirectory: input.paths.productionDirectory,
        backupRoot: input.paths.backupRoot,
        now: input.now,
      }),
    build: async (version) => {
      console.log(`\nCompilation d'Arkadia ${version}...\n`);
      const commandInterpreter = NodeProcess.env.ComSpec ?? "cmd.exe";
      await runVisibleCommand(commandInterpreter, ["/d", "/s", "/c", "pnpm dist:desktop:win:x64"], {
        cwd: input.paths.repositoryRoot,
        env: {
          ...process.env,
          RUSTUP_TOOLCHAIN: "1.97.1-x86_64-pc-windows-msvc",
          T3CODE_DESKTOP_VERSION: version,
        },
      });
      const installerPath = NodePath.join(
        input.paths.repositoryRoot,
        "release",
        `T3-Code-${version}-x64.exe`,
      );
      if (!(await pathExists(installerPath))) {
        throw new Error(`L'installateur attendu est introuvable : ${installerPath}`);
      }
      return installerPath;
    },
    install: async (installerPath) => {
      console.log("\nInstallation silencieuse de la mise à jour...\n");
      await runVisibleCommand(installerPath, ["/S"]);
    },
    restart: async () => {
      if (!(await pathExists(input.paths.installedExecutablePath))) {
        throw new Error(
          `L'exécutable installé est introuvable : ${input.paths.installedExecutablePath}`,
        );
      }
      const child = NodeChildProcess.spawn(input.paths.installedExecutablePath, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
    },
  };
}

function makeDryRunOperations(input: {
  readonly paths: LocalUpdatePaths;
  readonly now: Date;
}): LocalUpdateOperations {
  const backupDirectory = NodePath.join(
    input.paths.backupRoot,
    `production-config-${makeBackupTimestamp(input.now)}`,
  );
  return {
    listProcesses: listWindowsProcesses,
    synchronize: async () => {
      console.log(`[simulation] Synchroniser ${input.paths.developmentDirectory}`);
      console.log(`[simulation] Sauvegarder vers ${backupDirectory}`);
      return { backupDirectory };
    },
    build: async (version) => {
      const installerPath = NodePath.join(
        input.paths.repositoryRoot,
        "release",
        `T3-Code-${version}-x64.exe`,
      );
      console.log(`[simulation] Compiler ${version} vers ${installerPath}`);
      return installerPath;
    },
    install: async (installerPath) => {
      console.log(`[simulation] Installer silencieusement ${installerPath}`);
    },
    restart: async () => {
      console.log(`[simulation] Redémarrer ${input.paths.installedExecutablePath}`);
    },
  };
}

async function main(): Promise<void> {
  if (NodeProcess.platform !== "win32") {
    throw new Error("Cette automatisation locale Arkadia est réservée à Windows.");
  }
  const args = parseLocalUpdateArgs(NodeProcess.argv.slice(2));
  const repositoryRoot = NodeProcess.cwd();
  const homeDirectory = NodeProcess.env.USERPROFILE;
  const localAppDataDirectory = NodeProcess.env.LOCALAPPDATA;
  if (!homeDirectory || !localAppDataDirectory) {
    throw new Error("USERPROFILE ou LOCALAPPDATA est indisponible.");
  }

  const paths = makeLocalUpdatePaths(repositoryRoot, homeDirectory, localAppDataDirectory);
  const developmentElectronPath = await resolveExistingPath(paths.developmentElectronPath);
  const developmentServerPid = await readDevelopmentServerPid(paths.developmentRuntimePath);
  const now = new Date();
  const baseVersion = await readBaseVersion(repositoryRoot);
  const result = await runLocalArkadiaUpdate(
    {
      baseVersion,
      now,
      syncOnly: args.syncOnly,
      blockingPaths: {
        installedExecutablePath: paths.installedExecutablePath,
        developmentElectronPath,
        developmentServerPid,
      },
    },
    args.dryRun ? makeDryRunOperations({ paths, now }) : makeRealOperations({ paths, now }),
  );

  console.log(`\nSauvegarde de configuration : ${result.backupDirectory}`);
  if (args.syncOnly) {
    console.log("Migration de configuration terminée.");
    return;
  }
  console.log(`Mise à jour Arkadia ${result.version} terminée.`);
}

const entryPath = NodeProcess.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(entryPath)).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nERREUR : ${message}`);
    // Assigning rather than calling `exit()` lets the error above finish
    // flushing to the console. The namespace import types `exitCode` as a
    // read-only binding, so the assignment goes through the global.
    globalThis.process.exitCode = 1;
  });
}
