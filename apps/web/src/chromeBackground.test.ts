import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { describe, expect, it } from "vite-plus/test";

const chromeSection = await Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const stylesheetPath = decodeURIComponent(
    new URL("./index.css", import.meta.url).pathname,
  ).replace(/^\/([A-Za-z]:\/)/, "$1");
  return yield* fileSystem.readFileString(stylesheetPath);
}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

describe("Chrome background layering", () => {
  it("paints the selected gradient once on the window wrapper", () => {
    expect(chromeSection.match(/var\(--app-chrome-image\)/g)).toHaveLength(1);
    expect(chromeSection).toMatch(
      /\[data-slot="sidebar-wrapper"\]\s*\{[^}]*background-image:\s*var\(--app-chrome-image\)/s,
    );
  });

  it("lets the global gradient reach the conversation toolbar", () => {
    expect(chromeSection).toMatch(
      /\[data-chat-view\]\s*\{[^}]*background-color:\s*transparent\s*!important/s,
    );
  });
});
