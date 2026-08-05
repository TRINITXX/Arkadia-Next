import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TerminalViewport } from "~/components/ThreadTerminalDrawer";
import { useProject } from "~/state/entities";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { terminalEnvironment } from "~/state/terminal";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectTerminalThreadId } from "~/terminal/projectTerminals";
import { ArkadiaToolbar } from "../toolbar/ArkadiaToolbar";
import { useProjectTerminalsStore } from "./projectTerminalsStore";

interface ProjectTerminalViewProps {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  terminalId: string;
  /** Called when the shell exits, so the tab can close itself. */
  onExited: () => void;
}

/**
 * A project terminal filling the whole workspace, as its own tab beside the
 * conversations. Opens the PTY itself (the viewport only attaches to one) and
 * runs the pending command a toolbar action left behind, if any.
 */
export function ProjectTerminalView({
  environmentId,
  projectId,
  terminalId,
  onExited,
}: ProjectTerminalViewProps) {
  const navigate = useNavigate();
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const project = useProject(projectRef);
  const threadId = useMemo(() => projectTerminalThreadId(projectId), [projectId]);
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const takePendingCommand = useProjectTerminalsStore((store) => store.takePendingCommand);
  const openProjectTerminal = useProjectTerminalsStore((store) => store.openTerminal);
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);

  const workspaceRoot = project?.workspaceRoot ?? null;
  const runtimeEnv = useMemo(
    () => (workspaceRoot ? projectScriptRuntimeEnv({ project: { cwd: workspaceRoot } }) : null),
    [workspaceRoot],
  );

  useEffect(() => {
    if (!workspaceRoot || !runtimeEnv) return;
    let cancelled = false;

    void (async () => {
      // No cols/rows: the viewport's surface measures itself and issues the
      // real resize, so guessing a geometry here would only make the shell
      // reflow once for nothing. Re-opening an already-running terminal
      // (navigating back to this tab) reattaches rather than restarting.
      const openResult = await openTerminal({
        environmentId,
        input: { threadId, terminalId, cwd: workspaceRoot, env: runtimeEnv },
      });
      if (cancelled) return;
      if (openResult._tag === "Failure") {
        if (isAtomCommandInterrupted(openResult)) return;
        const error = squashAtomCommandFailure(openResult);
        setLaunchError(error instanceof Error ? error.message : "Impossible d'ouvrir le terminal.");
        return;
      }
      setLaunchError(null);

      const command = takePendingCommand(projectRef, terminalId);
      if (command === null || cancelled) return;
      const writeResult = await writeTerminal({
        environmentId,
        input: { threadId, terminalId, data: `${command}\r` },
      });
      if (cancelled || writeResult._tag !== "Failure" || isAtomCommandInterrupted(writeResult)) {
        return;
      }
      const error = squashAtomCommandFailure(writeResult);
      setLaunchError(error instanceof Error ? error.message : "Impossible de lancer la commande.");
    })();

    return () => {
      cancelled = true;
    };
  }, [
    environmentId,
    openTerminal,
    projectRef,
    runtimeEnv,
    takePendingCommand,
    terminalId,
    threadId,
    workspaceRoot,
    writeTerminal,
  ]);

  const openProjectSettings = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  const runToolbarAction = useCallback(
    (command: string) => {
      const nextTerminalId = openProjectTerminal(projectRef, { pendingCommand: command });
      void navigate({
        to: "/$environmentId/project/$projectId/terminal/$terminalId",
        params: { environmentId, projectId, terminalId: nextTerminalId },
      });
    },
    [environmentId, navigate, openProjectTerminal, projectId, projectRef],
  );
  const restoreTerminalFocus = useCallback(() => setFocusRequestId((current) => current + 1), []);

  if (!workspaceRoot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-muted-foreground text-sm">
          Ce projet n’est plus disponible : son terminal ne peut pas être ouvert.
        </p>
        <button
          type="button"
          onClick={openProjectSettings}
          className="cursor-pointer text-primary text-sm underline-offset-4 hover:underline"
        >
          Revenir à l’accueil
        </button>
      </div>
    );
  }

  return (
    <div className="thread-terminal-drawer flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header
        data-chat-header=""
        data-project-terminal-toolbar=""
        className="workspace-topbar drag-region relative h-9! min-h-9! shrink-0 bg-zinc-950 px-2"
      >
        <ArkadiaToolbar
          browserAvailable={false}
          onRunAction={runToolbarAction}
          onOpenNotepad={restoreTerminalFocus}
          onOpenBrowser={restoreTerminalFocus}
        />
      </header>
      {launchError !== null && (
        <div className="shrink-0 border-destructive/40 border-b bg-destructive/10 px-3 py-1.5 text-destructive-foreground text-xs">
          {launchError}
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1 p-1">
        <TerminalViewport
          key={`${environmentId}:${projectId}:${terminalId}`}
          threadRef={threadRef}
          threadId={threadId}
          terminalId={terminalId}
          terminalLabel="Terminal"
          cwd={workspaceRoot}
          {...(runtimeEnv ? { runtimeEnv } : {})}
          onSessionExited={onExited}
          focusRequestId={focusRequestId}
          autoFocus
          // The Ghostty surface observes its own container and refits, so this
          // surface has no drawer geometry to feed back in.
          resizeEpoch={0}
          drawerHeight={0}
          keybindings={keybindings}
        />
      </div>
    </div>
  );
}
