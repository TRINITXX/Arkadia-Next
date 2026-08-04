import { useNavigate } from "@tanstack/react-router";
import type { DesktopNotificationKind } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useProjects, useThreadShells } from "../state/entities";
import { useClientSettings } from "./useSettings";

type ThreadShell = ReturnType<typeof useThreadShells>[number];

// How long to wait after an event before the popup appears. If the user returns
// to the app (or the app is focused) within this window, the popup is skipped —
// you don't need a corner toast for something you're already looking at.
const NOTIFICATION_GRACE_MS = 5000;

interface ThreadSignal {
  readonly waiting: boolean;
  readonly error: boolean;
  readonly latestTurnState: string | null;
}

function deriveThreadSignal(thread: ThreadShell): ThreadSignal {
  return {
    waiting: thread.hasPendingApprovals || thread.hasPendingUserInput,
    error: thread.session?.status === "error" || thread.latestTurn?.state === "error",
    latestTurnState: thread.latestTurn?.state ?? null,
  };
}

function threadKey(thread: ThreadShell): string {
  return `${String(thread.environmentId)}:${String(thread.id)}`;
}

// Resolve the live app background/foreground so the popup — a separate window
// that doesn't load the app CSS — matches exactly.
function resolveNotificationColors(): { background: string; foreground: string } {
  const bodyStyle = getComputedStyle(document.body);
  let background = bodyStyle.backgroundColor;
  if (!background || background === "rgba(0, 0, 0, 0)" || background === "transparent") {
    background = getComputedStyle(document.documentElement).backgroundColor;
  }
  const foreground = bodyStyle.color || getComputedStyle(document.documentElement).color;
  return {
    background: background || "#0a0a0a",
    foreground: foreground || "#fafafa",
  };
}

/**
 * Desktop-only: watches every thread across environments and, when one finishes,
 * starts waiting for the user, or errors while the app is in the background,
 * asks the main process to show a compact corner popup (see DesktopWindow's
 * showNotification). Clicking the popup navigates here to that thread. A no-op on
 * web (no `desktopBridge`) or when the setting is off.
 */
export function useDesktopThreadNotifications(): void {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const enabled = useClientSettings((settings) => settings.desktopNotifications);

  const previousSignalsRef = useRef<Map<string, ThreadSignal>>(new Map());
  const initializedRef = useRef(false);
  const graceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Navigate to the clicked popup's thread. Registered once; the main process
  // reveals the window itself, this just routes to the thread.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onNotificationOpenThread) return;
    return bridge.onNotificationOpenThread((target) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      });
    });
  }, [navigate]);

  // Clear any pending grace timers on unmount only (not on every shells change,
  // which would cancel graces mid-flight).
  useEffect(
    () => () => {
      for (const timer of graceTimersRef.current.values()) {
        clearTimeout(timer);
      }
      graceTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const nextSignals = new Map<string, ThreadSignal>();
    for (const thread of threads) {
      nextSignals.set(threadKey(thread), deriveThreadSignal(thread));
    }

    // When disabled (or on web), just track state so re-enabling doesn't fire a
    // burst of stale transitions.
    if (!enabled || !window.desktopBridge?.showNotification) {
      previousSignalsRef.current = nextSignals;
      initializedRef.current = true;
      return;
    }

    const previous = previousSignalsRef.current;
    if (initializedRef.current) {
      for (const thread of threads) {
        const key = threadKey(thread);
        const before = previous.get(key);
        const current = nextSignals.get(key)!;
        const kind: DesktopNotificationKind | null =
          current.waiting && !(before?.waiting ?? false)
            ? "waiting"
            : current.error && !(before?.error ?? false)
              ? "error"
              : current.latestTurnState === "completed" &&
                  (before?.latestTurnState ?? null) !== "completed"
                ? "finished"
                : null;
        if (kind) {
          scheduleNotification(key, thread, kind);
        }
      }
    }

    previousSignalsRef.current = nextSignals;
    initializedRef.current = true;

    function scheduleNotification(key: string, thread: ThreadShell, kind: DesktopNotificationKind) {
      const existing = graceTimersRef.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        graceTimersRef.current.delete(key);
        // Only surface it if the app is still in the background.
        if (document.hasFocus()) return;
        const bridge = window.desktopBridge;
        if (!bridge?.showNotification) return;
        const project = projectsRef.current.find(
          (candidate) =>
            String(candidate.environmentId) === String(thread.environmentId) &&
            String(candidate.id) === String(thread.projectId),
        );
        const { background, foreground } = resolveNotificationColors();
        void bridge.showNotification({
          environmentId: String(thread.environmentId),
          threadId: String(thread.id),
          kind,
          projectName: project?.title ?? "Projet",
          threadTitle: thread.title,
          background,
          foreground,
        });
      }, NOTIFICATION_GRACE_MS);
      graceTimersRef.current.set(key, timer);
    }
  }, [threads, enabled]);
}
