import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  getTreeSitterClient,
  type DiffRenderable,
  type ScrollBoxRenderable,
  SyntaxStyle,
  TreeSitterClient,
} from "@opentui/core";
import type { ExtensionPaneProps } from "hunkdiff/extension";
import { EXTENSION_ID } from "./constants.js";
import { getSidebarSnapshot, subscribeSidebar } from "./state.js";

const SCROLL_RETRY_DELAY_MS = 50;

function mixColor(background: string, tint: string, amount: number): string {
  const parse = (value: string) => {
    const hex = value.replace(/^#/, "");
    if (![3, 6, 8].includes(hex.length) || !/^[\da-f]+$/i.test(hex)) return null;
    const rgb = hex.length === 8 ? hex.slice(0, 6) : hex;
    const expanded = rgb.length === 3 ? rgb.split("").map((part) => part + part).join("") : rgb;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
    ];
  };
  const baseRgb = parse(background);
  const tintRgb = parse(tint);
  if (!baseRgb || !tintRgb) return background;

  return `#${baseRgb
    .map((channel, index) => Math.round(channel + (tintRgb[index] - channel) * amount))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function CompleteFilePane({
  files,
  actions,
  theme,
  width,
  height,
}: ExtensionPaneProps) {
  const snapshot = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, getSidebarSnapshot);
  const palette = useMemo(() => {
    const isLight = theme.appearance === "light";
    return {
      text: isLight ? "#172033" : "#e5e7eb",
      muted: isLight ? "#526078" : "#a8b3c7",
      keyword: isLight ? "#9d174d" : "#f472b6",
      string: isLight ? "#047857" : "#6ee7b7",
      number: isLight ? "#6d28d9" : "#c4b5fd",
      type: isLight ? "#0369a1" : "#7dd3fc",
      operator: isLight ? "#334155" : "#f8fafc",
      punctuation: isLight ? "#475569" : "#cbd5e1",
      comment: isLight ? "#64748b" : "#94a3b8",
      added: mixColor(theme.background, theme.badgeAdded, isLight ? 0.2 : 0.32),
      removed: mixColor(theme.background, theme.badgeRemoved, isLight ? 0.2 : 0.32),
      addedSign: theme.badgeAdded,
      removedSign: theme.badgeRemoved,
    };
  }, [theme]);
  const syntaxStyle = useMemo(
    () =>
      SyntaxStyle.fromStyles({
        comment: { fg: palette.comment, italic: true },
        keyword: { fg: palette.keyword },
        string: { fg: palette.string },
        "string.special": { fg: palette.string },
        number: { fg: palette.number },
        constant: { fg: palette.number },
        "constant.numeric": { fg: palette.number },
        "entity.name.function": { fg: palette.type },
        "entity.name.type": { fg: palette.type },
        function: { fg: palette.type },
        type: { fg: palette.type },
        "type.builtin": { fg: palette.type },
        variable: { fg: palette.text },
        operator: { fg: palette.operator },
        punctuation: { fg: palette.punctuation },
        "punctuation.delimiter": { fg: palette.punctuation },
        "punctuation.bracket": { fg: palette.punctuation },
      }),
    [palette],
  );

  useEffect(() => () => syntaxStyle.destroy(), [syntaxStyle]);

  if (!snapshot) {
    return (
      <box style={{ width, height, backgroundColor: theme.background }}>
        <text content="Press Ctrl+O with a file selected" style={{ fg: theme.muted }} />
      </box>
    );
  }

  const file = files.find((item) => item.id === snapshot.fileId);
  const filetype = file?.language ?? "text";

  return (
    <box style={{ width, height, backgroundColor: theme.background }}>
      <box
        style={{
          width: "100%",
          height: 2,
          paddingLeft: 1,
          paddingRight: 1,
          flexDirection: "row",
          backgroundColor: theme.background,
          borderStyle: "single",
          borderColor: theme.border,
        }}
      >
        <text content={`HUNK-DIFF-CONTEXT  ${snapshot.path}`} style={{ fg: theme.text }} />
      </box>
      <DiffContent
        diff={snapshot.diff}
        filetype={filetype}
        syntaxStyle={syntaxStyle}
        width={width}
        height={height - 2}
        anchorRow={snapshot.anchorRow}
        hunkIndex={snapshot.hunkIndex}
        theme={theme}
        palette={palette}
        actions={actions}
      />
    </box>
  );
}

function DiffContent({
  diff,
  filetype,
  syntaxStyle,
  width,
  height,
  anchorRow,
  hunkIndex,
  theme,
  palette,
  actions,
}: {
  diff: string;
  filetype: string;
  syntaxStyle: SyntaxStyle;
  width: number;
  height: number;
  anchorRow: number;
  hunkIndex: number;
  theme: ExtensionPaneProps["theme"];
  palette: {
    text: string;
    muted: string;
    added: string;
    removed: string;
    addedSign: string;
    removedSign: string;
  };
  actions: ExtensionPaneProps["actions"];
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const diffRef = useRef<DiffRenderable | null>(null);
  const parserFailures = useRef(new Set<string>());
  const treeSitterClient = useMemo(
    () => getTreeSitterClient(),
    [],
  );

  useEffect(() => {
    void treeSitterClient.preloadParser(filetype).catch(() => {
      if (!parserFailures.current.has(filetype)) {
        parserFailures.current.add(filetype);
        actions.notify(
          `${EXTENSION_ID}: Syntax highlighting unavailable for ${filetype}`,
          "warning",
        );
      }
    });
  }, [actions, filetype, treeSitterClient]);

  useEffect(() => {
    const scrollToAnchor = () => {
      const offsets = diffRef.current?.getHunkRowOffsets() ?? [];
      const hunkOffset = offsets[Math.min(hunkIndex, offsets.length - 1)] ?? 0;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = Math.max(0, hunkOffset + anchorRow - 2);
      }
    };
    scrollToAnchor();
    const retry = setTimeout(scrollToAnchor, SCROLL_RETRY_DELAY_MS);
    return () => clearTimeout(retry);
  }, [anchorRow, diff, hunkIndex, width, height]);

  return (
    <scrollbox
      ref={scrollRef}
      width={width}
      height={height}
      scrollY
      focused={false}
    >
      <diff
        ref={diffRef}
        diff={diff}
        view="unified"
        wrapMode="word"
        filetype={filetype}
        syntaxStyle={syntaxStyle}
        treeSitterClient={treeSitterClient}
        width={width}
        height="auto"
        fg={palette.text}
        contextBg={theme.background}
        contextContentBg={theme.background}
        lineNumberBg={theme.background}
        lineNumberFg={palette.muted}
        addedBg={palette.added}
        removedBg={palette.removed}
        addedContentBg={palette.added}
        removedContentBg={palette.removed}
        addedSignColor={palette.addedSign}
        removedSignColor={palette.removedSign}
        showLineNumbers
      />
    </scrollbox>
  );
}
