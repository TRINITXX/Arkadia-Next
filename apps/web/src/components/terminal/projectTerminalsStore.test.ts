import { describe, expect, it } from "vite-plus/test";

import {
  addProjectTerminal,
  removeProjectTerminal,
  selectProjectTerminals,
  takeProjectTerminalCommand,
  type ProjectTerminalTab,
} from "./projectTerminalsStore";

const tabs = (...terminalIds: string[]): ProjectTerminalTab[] =>
  terminalIds.map((terminalId) => ({ terminalId }));

describe("selectProjectTerminals", () => {
  it("returns an empty list for a project that has never opened a terminal", () => {
    expect(selectProjectTerminals({}, "env:project")).toEqual([]);
  });

  it("returns an empty list when no project is selected", () => {
    expect(selectProjectTerminals({ "env:project": tabs("term-1") }, null)).toEqual([]);
  });
});

describe("addProjectTerminal", () => {
  it("appends a terminal with the first free dense id", () => {
    const result = addProjectTerminal(tabs("term-1", "term-3"));
    expect(result.terminalId).toBe("term-2");
    expect(result.tabs.map((tab) => tab.terminalId)).toEqual(["term-1", "term-3", "term-2"]);
  });

  it("carries a pending command only when one was asked for", () => {
    expect(addProjectTerminal([]).tabs[0]).toEqual({ terminalId: "term-1" });
    expect(addProjectTerminal([], { pendingCommand: "npm run dev" }).tabs[0]).toEqual({
      terminalId: "term-1",
      pendingCommand: "npm run dev",
    });
  });
});

describe("removeProjectTerminal", () => {
  it("drops the terminal and frees its id for the next one", () => {
    const remaining = removeProjectTerminal(tabs("term-1", "term-2", "term-3"), "term-2");
    expect(remaining.map((tab) => tab.terminalId)).toEqual(["term-1", "term-3"]);
    expect(addProjectTerminal(remaining).terminalId).toBe("term-2");
  });

  it("returns the same list untouched when the terminal is already gone", () => {
    const current = tabs("term-1");
    expect(removeProjectTerminal(current, "term-9")).toBe(current);
  });
});

describe("takeProjectTerminalCommand", () => {
  it("returns the command once and clears it, so a remount cannot run it twice", () => {
    const current: ProjectTerminalTab[] = [{ terminalId: "term-1", pendingCommand: "ccd" }];
    const first = takeProjectTerminalCommand(current, "term-1");
    expect(first.command).toBe("ccd");

    const second = takeProjectTerminalCommand(first.tabs, "term-1");
    expect(second.command).toBeNull();
    expect(second.tabs).toBe(first.tabs);
  });

  it("leaves the list alone for a terminal with nothing pending", () => {
    const current = tabs("term-1");
    const result = takeProjectTerminalCommand(current, "term-1");
    expect(result.command).toBeNull();
    expect(result.tabs).toBe(current);
  });

  it("ignores an unknown terminal", () => {
    const current: ProjectTerminalTab[] = [{ terminalId: "term-1", pendingCommand: "ccd" }];
    const result = takeProjectTerminalCommand(current, "term-2");
    expect(result.command).toBeNull();
    expect(result.tabs).toBe(current);
  });
});
