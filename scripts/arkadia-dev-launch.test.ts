import { describe, expect, it } from "vite-plus/test";
import packageJson from "../package.json" with { type: "json" };

describe("Arkadia desktop development launch", () => {
  it("uses the verified loopback backend port instead of the blocked T3 default", () => {
    expect(packageJson.scripts?.["dev:desktop"]).toBe(
      "node scripts/dev-runner.ts dev:desktop --port 14773",
    );
  });
});
