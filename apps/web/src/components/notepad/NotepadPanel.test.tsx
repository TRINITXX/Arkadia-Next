import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { NotepadPanel } from "./NotepadPanel";

describe("NotepadPanel", () => {
  it("renders a project-selection prompt instead of the editor when no project is active", () => {
    const markup = renderToStaticMarkup(<NotepadPanel projectId={null} />);

    expect(markup).toContain("Sélectionnez un projet pour utiliser le bloc-notes.");
    // The draft editor and its Copy button must not render without a project
    // to scope notes to — there is nowhere to persist them.
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("Copier");
  });
});
