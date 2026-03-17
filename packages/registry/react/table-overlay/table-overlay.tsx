import React, { useState, useMemo, useRef, useCallback } from "react";
import type { TableAnnotation, Rect, Word, ColumnDivider } from "@pdf-extractor/types";
import { extractTableData } from "@pdf-extractor/extract";
import { cn } from "@pdf-extractor/utils";

type TableOverlayProps = {
  table: TableAnnotation;
  pageRegion: Rect;
  canvasWidth: number;
  canvasHeight: number;
  words: Word[];
  ignoreRegions: Rect[];
  footerY: number | null;
  headerY: number | null;
  onUpdate: (table: TableAnnotation) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  onSelect: () => void;
  isMultiPage: boolean;
  currentPage: number;
  interactive: boolean;
  pageHeight: number;
};

export function TableOverlay(props: TableOverlayProps) {
  const [draggingCol, setDraggingCol] = useState<number | null>(null);
  const [hoverColIdx, setHoverColIdx] = useState<number | null>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);

  const px = useCallback(
    (nx: number) => nx * props.canvasWidth,
    [props.canvasWidth]
  );
  const py = useCallback(
    (ny: number) => ny * props.canvasHeight,
    [props.canvasHeight]
  );

  const regionPx = useMemo(
    () => ({
      left: px(props.pageRegion.x),
      top: py(props.pageRegion.y),
      width: px(props.pageRegion.w),
      height: py(props.pageRegion.h),
    }),
    [px, py, props.pageRegion]
  );

  const isWordInIgnoreZone = useCallback(
    (word: Word): boolean => {
      const cx = (word.x0 + word.x1) / 2;
      const cy = (word.y0 + word.y1) / 2;
      return props.ignoreRegions.some(
        (ig) =>
          cx >= ig.x &&
          cx <= ig.x + ig.w &&
          cy >= ig.y &&
          cy <= ig.y + ig.h
      );
    },
    [props.ignoreRegions]
  );

  const tableWords = useMemo(() => {
    const r = props.pageRegion;
    const fY = props.footerY;
    const hY = props.headerY;
    return props.words.filter((w) => {
      const cy = (w.y0 + w.y1) / 2;
      return (
        w.x0 >= r.x - 0.001 &&
        w.x1 <= r.x + r.w + 0.001 &&
        w.y0 >= r.y - 0.001 &&
        w.y1 <= r.y + r.h + 0.001 &&
        !isWordInIgnoreZone(w) &&
        (fY === null || cy < fY) &&
        (hY === null || cy > hY)
      );
    });
  }, [props.words, props.pageRegion, props.footerY, props.headerY, isWordInIgnoreZone]);

  const extractedData = useMemo(() => {
    if (tableWords.length === 0) return [];
    const gap = (props.table.lineMergeDistance ?? 0) / props.pageHeight;
    return extractTableData(tableWords, props.pageRegion, props.table.columns, gap);
  }, [tableWords, props.pageRegion, props.table.columns, props.table.lineMergeDistance, props.pageHeight]);

  function handleAddColumn(e: React.MouseEvent) {
    if (!props.selected) return;
    e.stopPropagation();

    const rect = tableRegionRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const normalizedX = clickX / rect.width;

    if (normalizedX > 0.02 && normalizedX < 0.98) {
      const newCols = [...props.table.columns, { position: normalizedX, splitPhrases: true }];
      props.onUpdate({ ...props.table, columns: newCols });
    }
  }

  function handleColMouseDown(idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setDraggingCol(idx);

    const startX = e.clientX;
    const colObj = props.table.columns[idx];
    const startVal = typeof colObj === "number" ? colObj : colObj.position;
    const regionW = regionPx.width;

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const newVal = Math.max(0.02, Math.min(0.98, startVal + dx / regionW));
      const newCols = [...props.table.columns];
      const existing = newCols[idx];
      newCols[idx] =
        typeof existing === "number"
          ? { position: newVal, splitPhrases: true }
          : { ...existing, position: newVal };
      props.onUpdate({ ...props.table, columns: newCols });
    }

    function onUp() {
      setDraggingCol(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleRemoveColumn(idx: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const newCols = props.table.columns.filter((_, i) => i !== idx);
    props.onUpdate({ ...props.table, columns: newCols });
  }

  const isStartPage = props.currentPage === props.table.startPage;
  const isEndPage = props.currentPage === (props.table.endPage ?? props.table.startPage);

  const borderStyle = cn(
    props.selected ? "border-blue-500" : "border-green-500",
    props.selected ? "bg-blue-500/5" : "bg-green-500/5",
    props.isMultiPage && "border-dashed"
  );

  return (
    <>
      {/* Table region */}
      <div
        ref={tableRegionRef}
        className={cn(
          "absolute border-2",
          props.interactive ? "pointer-events-auto" : "pointer-events-none",
          borderStyle
        )}
        style={{
          left: `${regionPx.left}px`,
          top: `${regionPx.top}px`,
          width: `${regionPx.width}px`,
          height: `${regionPx.height}px`,
          cursor: props.selected ? "crosshair" : "pointer",
          borderTopStyle: !isStartPage ? "dashed" : undefined,
          borderBottomStyle: !isEndPage ? "dashed" : undefined,
        }}
        onClick={(e) => {
          if (props.selected) {
            handleAddColumn(e);
          } else {
            e.stopPropagation();
            props.onSelect();
          }
        }}
      >
        {/* Column dividers */}
        {props.table.columns.map((col, idx) => {
          const pos = typeof col === "number" ? col : col.position;
          const split = typeof col === "number" ? true : col.splitPhrases;
          return (
            <div
              key={idx}
              className={cn(
                "absolute top-0 h-full w-0.5",
                hoverColIdx === idx
                  ? "bg-red-500"
                  : draggingCol === idx
                  ? "bg-blue-700"
                  : split
                  ? "bg-blue-500"
                  : "bg-orange-500"
              )}
              style={{
                left: `${pos * 100}%`,
                cursor: "col-resize",
                paddingLeft: "4px",
                paddingRight: "4px",
                marginLeft: "-4px",
              }}
              onMouseDown={(e) => handleColMouseDown(idx, e)}
              onContextMenu={(e) => handleRemoveColumn(idx, e)}
              onMouseEnter={() => setHoverColIdx(idx)}
              onMouseLeave={() => setHoverColIdx(null)}
            />
          );
        })}

        {/* Label (only on start page) */}
        {isStartPage && (
          <div
            className={cn(
              "absolute -top-6 left-0 px-1.5 py-0.5 text-xs text-white rounded-t",
              props.selected ? "bg-blue-500" : "bg-green-500"
            )}
          >
            Tabela
            {props.isMultiPage
              ? ` (p${props.table.startPage}\u2013${props.table.endPage})`
              : ""}
            <button
              className="ml-2 hover:text-red-200"
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete(props.table.id);
              }}
            >
              x
            </button>
          </div>
        )}

        {/* Continuation indicator */}
        {props.isMultiPage && !isStartPage && (
          <div className="absolute -top-5 left-0 text-xs text-gray-400">
            ...continua da p{props.table.startPage}
          </div>
        )}
        {props.isMultiPage && !isEndPage && (
          <div className="absolute -bottom-5 left-0 text-xs text-gray-400">
            continua na próxima página...
          </div>
        )}

        {/* Hint when selected and no columns */}
        {props.selected && props.table.columns.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-blue-500 bg-white/80 px-2 py-1 rounded">
              Clique para adicionar divisores de coluna | Clique direito para remover
            </span>
          </div>
        )}
      </div>

      {/* Extracted data preview */}
      {props.selected && extractedData.length > 0 && (
        <div
          className="absolute bg-white border border-gray-300 rounded shadow-lg p-2 text-xs max-h-60 overflow-auto z-50 pointer-events-auto"
          style={{
            left: `${regionPx.left}px`,
            top: `${regionPx.top + regionPx.height + 8}px`,
            minWidth: `${Math.min(regionPx.width, 500)}px`,
          }}
        >
          <div className="text-gray-400 mb-1">
            Página {props.currentPage} &mdash; {extractedData.length} linhas
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {extractedData.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-gray-100">
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="px-2 py-1 border-r border-gray-100 last:border-r-0"
                    >
                      {cell || "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
