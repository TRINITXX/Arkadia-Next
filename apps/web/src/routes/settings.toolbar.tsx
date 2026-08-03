import { createFileRoute } from "@tanstack/react-router";

import { ToolbarSettingsPanel } from "../components/settings/ToolbarSettingsPanel";

function SettingsToolbarRoute() {
  return (
    <ToolbarSettingsPanel
      settingsKey="toolbarButtons"
      heading="Barre d'outils"
      subheading="Glissez pour réordonner ou déposer dans un dossier. Cliquez sur un élément pour le modifier."
      commandLabel="Commande"
      commandPlaceholder="commande powershell (ex. npm run dev)"
    />
  );
}

export const Route = createFileRoute("/settings/toolbar")({
  component: SettingsToolbarRoute,
});
