import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useSettings", async () => {
  const { DEFAULT_UNIFIED_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    usePrimarySettings: () => DEFAULT_UNIFIED_SETTINGS,
    useUpdatePrimarySettings: () => vi.fn(),
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useLocation: ({ select }: { select: (location: { hash: string }) => unknown }) =>
      select({ hash: "" }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironment: () => null,
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));

vi.mock("./AddProviderInstanceDialog", () => ({
  AddProviderInstanceDialog: () => null,
}));

vi.mock("./ProviderInstanceCard", () => ({
  ProviderInstanceCard: ({ instanceId }: { instanceId: string }) => (
    <div data-provider-instance={instanceId} />
  ),
}));

import { ProviderSettingsPanel } from "./SettingsPanels";

describe("ProviderSettingsPanel", () => {
  it("renders default settings when a client-only provider has no legacy config", () => {
    expect(() => renderToStaticMarkup(<ProviderSettingsPanel />)).not.toThrow();
  });
});
