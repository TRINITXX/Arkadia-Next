import { createFileRoute } from "@tanstack/react-router";

import { ToolbarSettingsPanel } from "../components/settings/ToolbarSettingsPanel";

function SettingsPromptButtonsRoute() {
  return (
    <ToolbarSettingsPanel
      settingsKey="promptButtons"
      heading="Boutons du prompt"
      subheading="Glissez pour réordonner ou déposer dans un dossier. Cliquez sur un élément pour le modifier."
      commandLabel="Texte inséré"
      commandPlaceholder="texte inséré dans le composeur (ex. /commit)"
      showSubmit
    />
  );
}

export const Route = createFileRoute("/settings/prompt-buttons")({
  component: SettingsPromptButtonsRoute,
});
