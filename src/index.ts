import type {
  ExtensionDiffFile,
  ExtensionNotifyType,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import { COMMAND_ID, EXTENSION_ID, PANE_ID, PANE_TITLE } from "./constants.js";
import { CompleteFilePane } from "./pane.js";
import {
  createCompleteFileDiffModel,
  getSidebarSnapshot,
  sidebarCommandAction,
  sourceLineToDiffRowFromRows,
  setSidebarSnapshot,
  splitDocument,
} from "./state.js";

type ReadDocument = (fileId: string, side: "old" | "new") => Promise<string | null>;

type SidebarCommandContext = {
  notify: (message: string, type?: ExtensionNotifyType) => void;
  panes: {
    isOpen(viewId: string): boolean;
    open(viewId: string): void;
    close(viewId: string): void;
  };
  selection: {
    file: ExtensionDiffFile | null;
    hunkIndex: number | null;
  };
  workspace: {
    readDocument(fileId: string, side: "old" | "new"): Promise<string | null>;
  };
};

export function createToggleCompleteFileCommand() {
  let updateGeneration = 0;

  const updateSidebar = async (
    file: ExtensionDiffFile,
    hunkIndex: number,
    read: ReadDocument,
    notify: (message: string, type?: ExtensionNotifyType) => void,
  ): Promise<boolean> => {
    const generation = ++updateGeneration;
    const selectedHunk = file.hunks?.[hunkIndex] ?? file.hunks?.[0];
    const resolvedHunkIndex = selectedHunk?.index ?? 0;
    const side = file.changeType === "deleted" ? "old" : "new";
    const range = side === "old" ? selectedHunk?.oldRange : selectedHunk?.newRange;
    let oldDocument: string | null;
    let newDocument: string | null;
    try {
      [oldDocument, newDocument] = await Promise.all([
        read(file.id, "old"),
        read(file.id, "new"),
      ]);
    } catch {
      if (generation === updateGeneration) {
        notify(`${EXTENSION_ID}: Could not read ${file.path}`, "warning");
      }
      return false;
    }

    if (generation !== updateGeneration) return false;
    if (oldDocument === null && newDocument === null) {
      notify(`${EXTENSION_ID}: Could not read ${file.path}`, "warning");
      return false;
    }

    const document = side === "old" ? oldDocument : newDocument;
    const lineCount = Math.max(1, splitDocument(document ?? "").length);
    const anchorLine = range?.[0] ?? 1;
    const clampedAnchorLine = Math.max(1, Math.min(anchorLine, lineCount));
    const model = createCompleteFileDiffModel(
      file.path,
      oldDocument ?? "",
      newDocument ?? "",
    );
    setSidebarSnapshot({
      fileId: file.id,
      path: file.path,
      side,
      diff: model.diff,
      anchorLine: clampedAnchorLine,
      anchorRow: sourceLineToDiffRowFromRows(
        model.rows,
        side,
        clampedAnchorLine,
      ),
      hunkIndex: resolvedHunkIndex,
      range: range ?? null,
    });
    return true;
  };

  return async (ctx: SidebarCommandContext) => {
    const file = ctx.selection.file;
    const action = sidebarCommandAction(
      ctx.panes.isOpen(PANE_ID),
      file?.id ?? null,
      ctx.selection.hunkIndex ?? 0,
      getSidebarSnapshot()?.fileId ?? null,
      getSidebarSnapshot()?.hunkIndex ?? null,
    );
    if (action === "close") {
      updateGeneration += 1;
      ctx.panes.close(PANE_ID);
      return;
    }

    if (!file) {
      ctx.notify(`${EXTENSION_ID}: No file selected`, "warning");
      return;
    }

    const readDocument: ReadDocument = (fileId, side) =>
      ctx.workspace.readDocument(fileId, side);
    const updated = await updateSidebar(
      file,
      ctx.selection.hunkIndex ?? 0,
      readDocument,
      (message, type) => ctx.notify(message, type),
    );
    if (action === "switch" || !updated) {
      return;
    }

    ctx.panes.open(PANE_ID);
  };
}

export default function (hunk: HunkExtensionAPI) {
  hunk.registerPane({
    id: PANE_ID,
    title: PANE_TITLE,
    placement: "right",
    defaultOpen: false,
    width: { preferred: 66, min: 32, max: 90 },
    component: CompleteFilePane,
  });

  hunk.registerCommand(
    {
      id: COMMAND_ID,
      title: "Toggle complete file sidebar",
      key: "ctrl+o",
    },
    createToggleCompleteFileCommand(),
  );
}
