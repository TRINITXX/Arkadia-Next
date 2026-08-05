import { type ServerLifecycleWelcomePayload } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  Outlet,
  createRootRoute,
  type ErrorComponentProps,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_BASE_NAME, APP_DISPLAY_NAME, APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppDisplayName } from "../branding.logic";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { ConnectOnboardingDialog } from "../components/cloud/ConnectOnboardingDialog";
import { RelayClientInstallDialog } from "../components/cloud/RelayClientInstallDialog";
import { SshPasswordPromptDialog } from "../components/desktop/SshPasswordPromptDialog";
import { ProviderUpdateLaunchNotification } from "../components/ProviderUpdateLaunchNotification";
import { SlowRpcRequestToastCoordinator } from "../components/SlowRpcRequestToastCoordinator";
import { Button } from "../components/ui/button";
import {
  AnchoredToastProvider,
  stackedThreadToast,
  ToastProvider,
  toastManager,
} from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { useClientSettings } from "../hooks/useSettings";
import { useDesktopThreadNotifications } from "../hooks/useDesktopThreadNotifications";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKeyFromPath,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useUiStateStore } from "../uiStateStore";
import { syncBrowserChromeTheme, useTheme } from "../hooks/useTheme";
import { resolveChromeBackground } from "../lib/backgrounds";
import { isNativeContentPalette, resolveContentPalette } from "../lib/palettes";
import { DEFAULT_AGENT_FONT_FAMILY, DEFAULT_AGENT_FONT_SIZE } from "@t3tools/contracts/settings";
import { configureClientTracing } from "../observability/clientTracing";
import { resolveInitialServerAuthGateState } from "../environments/primary";
import { hasHostedPairingRequest, isHostedStaticApp } from "../hostedPairing";
import { shellEnvironment } from "../state/shell";
import { useAtomValue } from "@effect/atom-react";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironments, usePrimaryEnvironment } from "../state/environments";
import {
  primaryServerConfigAtom,
  primaryServerConfigEventAtom,
  primaryServerWelcomeAtom,
} from "../state/server";
import { readProject, setActiveEnvironmentId, useActiveEnvironmentId } from "../state/entities";
import {
  createKeybindingsUpdateToastController,
  type KeybindingsUpdateToastController,
} from "../components/KeybindingsUpdateToast.logic";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/pair" && hasHostedPairingRequest(new URL(window.location.href))) {
      return {
        authGateState: {
          status: "hosted-pairing",
        } as const,
      };
    }

    if (isHostedStaticApp(new URL(window.location.href))) {
      return {
        authGateState: {
          status: "hosted-static",
        } as const,
      };
    }

    const authGateState = await resolveInitialServerAuthGateState();
    return {
      authGateState,
    };
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { authGateState } = Route.useRouteContext();
  const primaryEnvironmentAuthenticated = authGateState.status === "authenticated";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncBrowserChromeTheme();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  if (pathname === "/pair" || pathname === "/connect" || pathname.startsWith("/connect/")) {
    return (
      <>
        <DocumentTitleSync />
        <Outlet />
      </>
    );
  }

  if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
    return (
      <>
        <DocumentTitleSync />
        <Outlet />
      </>
    );
  }

  const appShell = (
    <AppSidebarLayout>
      <Outlet />
    </AppSidebarLayout>
  );

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <DocumentTitleSync />
        <GlassAppearanceSync />
        <ContentPaletteSync />
        <ChromeBackgroundSync />
        <AgentFontSync />
        <TerminalFontSync />
        {primaryEnvironmentAuthenticated ? <AuthenticatedTracingBootstrap /> : null}
        <RelayClientInstallDialog />
        <ConnectOnboardingDialog />
        <SshPasswordPromptDialog />
        <SlowRpcRequestToastCoordinator />
        <HostedStaticEnvironmentBootstrap />
        {primaryEnvironmentAuthenticated ? <EventRouter /> : null}
        {primaryEnvironmentAuthenticated ? <DesktopNotificationsBridge /> : null}
        {primaryEnvironmentAuthenticated ? <ProviderUpdateLaunchNotification /> : null}
        {appShell}
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

// Desktop-only corner notifications. Null component so the hook lives on the
// authenticated app tree, next to EventRouter.
function DesktopNotificationsBridge() {
  useDesktopThreadNotifications();
  return null;
}

function GlassAppearanceSync() {
  const glassOpacity = useClientSettings((settings) => settings.glassOpacity);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-opacity", `${glassOpacity}%`);
  }, [glassOpacity]);

  return null;
}

// Content-theme palette (agent thread + terminal). Sets --content-bg/-fg on
// <html> and flags data-content-palette; index.css scopes the override to the
// content region. Mutating <html>.style also wakes the terminal's theme
// observer (ThreadTerminalDrawer), so the terminal re-reads its computed bg.
function ContentPaletteSync() {
  const paletteId = useClientSettings((settings) => settings.contentPaletteId);
  const customPalette = useClientSettings((settings) => settings.customContentPalette);

  useEffect(() => {
    const root = document.documentElement;
    // "arkadia" = follow the app's own light/dark tokens: clear the override.
    if (isNativeContentPalette(paletteId)) {
      root.removeAttribute("data-content-palette");
      root.style.removeProperty("--content-bg");
      root.style.removeProperty("--content-fg");
      return;
    }
    const palette = resolveContentPalette(paletteId, customPalette);
    root.style.setProperty("--content-bg", palette.bg);
    root.style.setProperty("--content-fg", palette.fg);
    root.setAttribute("data-content-palette", "on");
  }, [paletteId, customPalette]);

  return null;
}

// Chrome background (frosted-glass gradient presets). Dark mode only: sets the
// gradient on --app-chrome-image and flags data-chrome-glass; index.css layers
// the gradient behind the chrome and frosts the sidebar + tab strip.
function ChromeBackgroundSync() {
  const backgroundId = useClientSettings((settings) => settings.chromeBackgroundId);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    const background = resolveChromeBackground(backgroundId);
    const active = resolvedTheme === "dark" && background.glass && background.id !== "noir";
    if (active) {
      root.style.setProperty("--app-chrome-image", background.css);
      root.setAttribute("data-chrome-glass", "on");
    } else {
      root.style.removeProperty("--app-chrome-image");
      root.removeAttribute("data-chrome-glass");
    }
  }, [backgroundId, resolvedTheme]);

  return null;
}

// Agent-thread font. Only overrides when the user diverges from the default, so
// the default rendering of `.chat-markdown` is preserved untouched.
function AgentFontSync() {
  const agentFontFamily = useClientSettings((settings) => settings.agentFontFamily);
  const agentFontSize = useClientSettings((settings) => settings.agentFontSize);

  useEffect(() => {
    const style = document.documentElement.style;
    if (agentFontFamily === DEFAULT_AGENT_FONT_FAMILY) {
      style.removeProperty("--agent-font-family");
    } else {
      style.setProperty("--agent-font-family", agentFontFamily);
    }
    if (agentFontSize === DEFAULT_AGENT_FONT_SIZE) {
      style.removeProperty("--agent-font-size");
    } else {
      style.setProperty("--agent-font-size", `${agentFontSize}px`);
    }
  }, [agentFontFamily, agentFontSize]);

  return null;
}

// Terminal font. Always publishes concrete values on <html>; the terminal reads
// them via `terminalFontFromApp` (canvas can't read CSS vars). Mutating the vars
// wakes the terminal's observer, which calls `surface.setFont`.
function TerminalFontSync() {
  const terminalFontFamily = useClientSettings((settings) => settings.terminalFontFamily);
  const terminalFontSize = useClientSettings((settings) => settings.terminalFontSize);

  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--terminal-font-family", terminalFontFamily);
    style.setProperty("--terminal-font-size", `${terminalFontSize}px`);
  }, [terminalFontFamily, terminalFontSize]);

  return null;
}

function DocumentTitleSync() {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const title = resolveServerBackedAppDisplayName({
    baseName: APP_BASE_NAME,
    fallbackDisplayName: APP_DISPLAY_NAME,
    fallbackStageLabel: APP_STAGE_LABEL,
    primaryServerVersion,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

function HostedStaticEnvironmentBootstrap() {
  const { environments } = useEnvironments();
  const activeEnvironmentId = useActiveEnvironmentId();

  useEffect(() => {
    if (
      environments.some(
        (environment) => environment.entry.target._tag === "PrimaryConnectionTarget",
      )
    ) {
      return;
    }

    if (activeEnvironmentId) {
      return;
    }

    const firstSavedEnvironment = environments[0];
    if (!firstSavedEnvironment) {
      return;
    }

    setActiveEnvironmentId(firstSavedEnvironment.environmentId);
  }, [activeEnvironmentId, environments]);

  return null;
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function AuthenticatedTracingBootstrap() {
  useEffect(() => {
    void configureClientTracing();
  }, []);

  return null;
}

function EventRouter() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironment = usePrimaryEnvironment();
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverConfigEvent = useAtomValue(primaryServerConfigEventAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const readPathname = useEffectEvent(() => pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const handledConfigEventRef = useRef(serverConfigEvent);
  const [keybindingsToastController] = useState<KeybindingsUpdateToastController>(() =>
    createKeybindingsUpdateToastController({}),
  );

  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload) return;

    setActiveEnvironmentId(payload.environment.environmentId);
    void (async () => {
      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
        return;
      }
      const bootstrapProject = readProject(
        scopeProjectRef(payload.environment.environmentId, payload.bootstrapProjectId),
      );
      const bootstrapProjectKey =
        (bootstrapProject
          ? deriveLogicalProjectKeyFromSettings(bootstrapProject, projectGroupingSettings)
          : null) ??
        (serverConfig?.cwd
          ? derivePhysicalProjectKeyFromPath(payload.environment.environmentId, serverConfig.cwd)
          : null) ??
        scopedProjectKey(
          scopeProjectRef(payload.environment.environmentId, payload.bootstrapProjectId),
        );
      useUiStateStore.getState().setProjectExpanded(bootstrapProjectKey, true);

      if (readPathname() !== "/") {
        return;
      }
      if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
        return;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: payload.environment.environmentId,
          threadId: payload.bootstrapThreadId,
        },
        replace: true,
      });
      handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
    })().catch(() => undefined);
  });

  const handleServerConfigUpdated = useEffectEvent(() => {
    const decision = keybindingsToastController.handle(serverConfigEvent);
    if (!decision) {
      return;
    }

    if (decision._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Keybindings updated",
        description: "Keybindings configuration reloaded successfully.",
      });
      return;
    }

    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: decision.message,
        actionVariant: "outline",
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            if (!serverConfig || !primaryEnvironment) {
              return;
            }

            const editor = resolveAndPersistPreferredEditor(serverConfig.availableEditors);
            if (!editor) {
              return;
            }
            void (async () => {
              const result = await openInEditor({
                environmentId: primaryEnvironment.environmentId,
                input: {
                  cwd: serverConfig.keybindingsConfigPath,
                  editor,
                },
              });
              if (result._tag === "Success") {
                return;
              }
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error ? error.message : "Unknown error opening file.",
                }),
              );
            })();
          },
        },
      }),
    );
  });

  useEffect(() => {
    if (!serverConfig) {
      return;
    }

    setActiveEnvironmentId(serverConfig.environment.environmentId);
  }, [serverConfig]);

  useEffect(() => {
    handleWelcome(serverWelcome);
  }, [serverWelcome]);

  useEffect(() => {
    if (serverConfigEvent === null || handledConfigEventRef.current === serverConfigEvent) {
      return;
    }
    handledConfigEventRef.current = serverConfigEvent;
    handleServerConfigUpdated();
  }, [serverConfigEvent]);

  return null;
}
