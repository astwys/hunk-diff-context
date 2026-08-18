import type { ExtensionFileSide } from "hunkdiff/extension";

export type SidebarSnapshot = {
  fileId: string;
  path: string;
  side: ExtensionFileSide;
  diff: string;
  anchorLine: number;
  anchorRow: number;
  hunkIndex: number;
  range: readonly [number, number] | null;
};

let snapshot: SidebarSnapshot | null = null;
const listeners = new Set<() => void>();

export type SidebarCommandAction = "open" | "close" | "switch";

export function sidebarCommandAction(
  isOpen: boolean,
  currentFileId: string | null,
  currentHunkIndex: number | null,
  sidebarFileId: string | null,
  sidebarHunkIndex: number | null,
): SidebarCommandAction {
  if (!isOpen) return "open";
  if (
    currentFileId === null ||
    (currentFileId === sidebarFileId && currentHunkIndex === sidebarHunkIndex)
  ) {
    return "close";
  }
  return "switch";
}

export function getSidebarSnapshot() {
  return snapshot;
}

export function subscribeSidebar(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSidebarSnapshot(next: SidebarSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function splitDocument(document: string): string[] {
  if (document === "") return [];
  return (document.endsWith("\n") ? document.slice(0, -1) : document).split("\n");
}

export function createCompleteFileDiff(
  path: string,
  oldDocument: string,
  newDocument: string,
): string {
  return createCompleteFileDiffModel(path, oldDocument, newDocument).diff;
}

export function createCompleteFileDiffModel(
  path: string,
  oldDocument: string,
  newDocument: string,
): { diff: string; rows: readonly DiffRow[] } {
  const oldLines = splitDocument(oldDocument);
  const newLines = splitDocument(newDocument);
  const rows = diffRows(oldLines, newLines);
  const oldStart = oldLines.length === 0 ? 0 : 1;
  const newStart = newLines.length === 0 ? 0 : 1;

  if (rows.length === 0) {
    return {
      diff: [`--- a/${path}`, `+++ b/${path}`, ""].join("\n"),
      rows,
    };
  }

  return {
    diff: [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
      ...rows.map(({ kind, line }) => `${kind}${line}`),
      "",
    ].join("\n"),
    rows,
  };
}

export function sourceLineToDiffRow(
  oldDocument: string,
  newDocument: string,
  side: ExtensionFileSide,
  sourceLine: number,
): number {
  return sourceLineToDiffRowFromRows(
    diffRows(splitDocument(oldDocument), splitDocument(newDocument)),
    side,
    sourceLine,
  );
}

export function sourceLineToDiffRowFromRows(
  rows: readonly DiffRow[],
  side: ExtensionFileSide,
  sourceLine: number,
): number {
  let oldLine = 0;
  let newLine = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.kind !== "+") oldLine += 1;
    if (row.kind !== "-") newLine += 1;
    if (side === "old" && oldLine === sourceLine && row.kind !== "+") return rowIndex;
    if (side === "new" && newLine === sourceLine && row.kind !== "-") return rowIndex;
  }
  return 0;
}

export type DiffRow = { kind: " " | "+" | "-"; line: string };

function diffRows(oldLines: readonly string[], newLines: readonly string[]): DiffRow[] {
  const max = oldLines.length + newLines.length;
  const trace: Map<number, number>[] = [];
  let frontier = new Map([[1, 0]]);

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down =
        diagonal === -distance ||
        (diagonal !== distance &&
          (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1));
      let oldIndex = down
        ? frontier.get(diagonal + 1) ?? 0
        : (frontier.get(diagonal - 1) ?? 0) + 1;
      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < oldLines.length &&
        newIndex < newLines.length &&
        oldLines[oldIndex] === newLines[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      frontier.set(diagonal, oldIndex);
      if (oldIndex >= oldLines.length && newIndex >= newLines.length) {
        return reconstructDiffRows(trace, oldLines, newLines, oldIndex, newIndex);
      }
    }
  }
  return [];
}

function reconstructDiffRows(
  trace: readonly Map<number, number>[],
  oldLines: readonly string[],
  newLines: readonly string[],
  oldIndex: number,
  newIndex: number,
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = oldIndex - newIndex;
    const down =
      diagonal === -distance ||
      (diagonal !== distance &&
        (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1));
    const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
    const previousOldIndex = frontier.get(previousDiagonal) ?? 0;
    const previousNewIndex = previousOldIndex - previousDiagonal;

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      rows.push({ kind: " ", line: oldLines[oldIndex - 1] });
      oldIndex -= 1;
      newIndex -= 1;
    }
    if (distance === 0) break;
    if (oldIndex === previousOldIndex) {
      rows.push({ kind: "+", line: newLines[newIndex - 1] });
      newIndex -= 1;
    } else {
      rows.push({ kind: "-", line: oldLines[oldIndex - 1] });
      oldIndex -= 1;
    }
  }
  return rows.reverse();
}
