import { expect, test } from "bun:test";
import type { ExtensionDiffFile } from "hunkdiff/extension";
import { createToggleCompleteFileCommand } from "./index";
import {
  createCompleteFileDiff,
  sidebarCommandAction,
  sourceLineToDiffRow,
  splitDocument,
} from "./state";

function createFile(id: string): ExtensionDiffFile {
  return {
    id,
    path: `${id}.ts`,
    patch: "",
    stats: { additions: 1, deletions: 1 },
    metadata: null,
    agent: null,
    hunks: [{ index: 0, header: "@@ -1,1 +1,1 @@", oldRange: [1, 1], newRange: [1, 1] }],
  };
}

function createContext(
  file: ExtensionDiffFile,
  readDocument: (fileId: string, side: "old" | "new") => Promise<string | null>,
  isOpen = false,
) {
  const notifications: Array<[string, string | undefined]> = [];
  const panes = {
    openCalls: 0,
    closeCalls: 0,
    isOpen: () => isOpen,
    open: () => {
      panes.openCalls += 1;
    },
    close: () => {
      panes.closeCalls += 1;
    },
  };
  return {
    context: {
      selection: { file, hunkIndex: 0 },
      panes,
      workspace: { readDocument },
      notify: (message: string, type?: string) => notifications.push([message, type]),
    },
    notifications,
    panes,
  };
}

test("splits a document into source rows without a phantom final line", () => {
  expect(splitDocument("one\ntwo\n")).toEqual(["one", "two"]);
});

test("represents an empty document with no rows", () => {
  expect(splitDocument("")).toEqual([]);
});

test("builds a complete unified diff", () => {
  expect(createCompleteFileDiff("example.ts", "const value = 1\nkeep\n", "const value = 2\nkeep\n"))
    .toContain("@@ -1,2 +1,2 @@\n-const value = 1\n+const value = 2\n keep");
});

test("includes all unchanged lines around a change", () => {
  const diff = createCompleteFileDiff("example.ts", "before\nsame\nafter\n", "before\nsame\nnew\n");
  expect(diff).toContain(" before\n same\n-after\n+new");
});

test("uses valid ranges for added and deleted files", () => {
  expect(createCompleteFileDiff("added.ts", "", "new\n")).toContain("@@ -0,0 +1,1 @@");
  expect(createCompleteFileDiff("deleted.ts", "old\n", "")).toContain("@@ -1,1 +0,0 @@");
  expect(createCompleteFileDiff("empty.ts", "", "")).not.toContain("@@");
});

test("switches an open sidebar when Ctrl+O targets another file", () => {
  expect(sidebarCommandAction(false, "a", 0, null, null)).toBe("open");
  expect(sidebarCommandAction(true, "a", 0, "a", 0)).toBe("close");
  expect(sidebarCommandAction(false, "a", 0, null, null)).toBe("open");
  expect(sidebarCommandAction(true, "b", 0, "a", 0)).toBe("switch");
});

test("scrolls an open sidebar when Ctrl+O targets another hunk", () => {
  expect(sidebarCommandAction(true, "a", 1, "a", 0)).toBe("switch");
});

test("maps a selected source line into the complete diff", () => {
  const oldDocument = "one\ntwo\nthree\n";
  const newDocument = "one\nchanged\nthree\n";
  expect(sourceLineToDiffRow(oldDocument, newDocument, "new", 2)).toBe(2);
  expect(sourceLineToDiffRow(oldDocument, newDocument, "old", 2)).toBe(1);
});

test("does not open the pane when reading the initial file fails", async () => {
  const file = createFile("failed");
  const { context, notifications, panes } = createContext(file, async () => {
    throw new Error("read failed");
  });

  await createToggleCompleteFileCommand()(context);

  expect(panes.openCalls).toBe(0);
  expect(notifications).toEqual([
    ["hunk-diff-context: Could not read failed.ts", "warning"],
  ]);
});

test("does not open the pane when both document sides are unavailable", async () => {
  const file = createFile("missing");
  const { context, notifications, panes } = createContext(file, async () => null);

  await createToggleCompleteFileCommand()(context);

  expect(panes.openCalls).toBe(0);
  expect(notifications).toEqual([
    ["hunk-diff-context: Could not read missing.ts", "warning"],
  ]);
});

test("opens the pane after a successful document read", async () => {
  const file = createFile("ready");
  const { context, notifications, panes } = createContext(file, async (_fileId, side) =>
    side === "old" ? "old\n" : "new\n",
  );

  await createToggleCompleteFileCommand()(context);

  expect(panes.openCalls).toBe(1);
  expect(notifications).toEqual([]);
});

test("ignores a superseded read result", async () => {
  const firstFile = createFile("first");
  const secondFile = createFile("second");
  let resolveFirst!: (value: string) => void;
  const firstRead = new Promise<string>((resolve) => {
    resolveFirst = resolve;
  });
  const notifications: Array<[string, string | undefined]> = [];
  const panes = {
    openCalls: 0,
    close: () => {},
    isOpen: () => false,
    open: () => {
      panes.openCalls += 1;
    },
  };
  const command = createToggleCompleteFileCommand();
  const createCommandContext = (file: ExtensionDiffFile) => ({
    selection: { file, hunkIndex: 0 },
    panes,
    workspace: {
      readDocument: async (fileId: string, side: "old" | "new") => {
        if (fileId === firstFile.id) return firstRead;
        return side === "old" ? "old\n" : "new\n";
      },
    },
    notify: (message: string, type?: string) => notifications.push([message, type]),
  });

  const firstCommand = command(createCommandContext(firstFile));
  await Promise.resolve();
  const secondCommand = command(createCommandContext(secondFile));
  await secondCommand;
  resolveFirst("first\n");
  await firstCommand;

  expect(panes.openCalls).toBe(1);
  expect(notifications).toEqual([]);
});
