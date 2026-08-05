import { describe, expect, it } from "vite-plus/test";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";

describe("BUILT_IN_DRIVERS", () => {
  it("registers Kimi as a first-class driver", () => {
    const kimi = BUILT_IN_DRIVERS.find((driver) => driver.driverKind === "kimi");
    expect(kimi?.metadata).toMatchObject({
      displayName: "Kimi",
      supportsMultipleInstances: true,
    });
  });
});
