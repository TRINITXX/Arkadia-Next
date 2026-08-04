import { useLocation } from "@tanstack/react-router";

import { isElectron } from "../env";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";

/**
 * The sidebar shown on the `/settings` routes: the shared chrome header plus the
 * settings navigation. The chat/project sidebar is {@link ArkadiaSidebar}; the two
 * no longer share any code.
 */
export function SettingsSidebar() {
  const pathname = useLocation({ select: (loc) => loc.pathname });
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SettingsSidebarNav pathname={pathname} />
    </>
  );
}
