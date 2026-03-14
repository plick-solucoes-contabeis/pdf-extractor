import React from "react";
import type { IgnoreAnnotation, Rect } from "@pdf-extractor/types";
import { cn } from "@pdf-extractor/utils";

type Props = {
  ignore: IgnoreAnnotation;
  pageRegion: Rect;
  canvasWidth: number;
  canvasHeight: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (ignore: IgnoreAnnotation) => void;
  onDelete: (id: string) => void;
  isMultiPage: boolean;
  currentPage: number;
  interactive: boolean;
};

export function IgnoreOverlay(props: Props) {
  const px = (nx: number) => nx * props.canvasWidth;
  const py = (ny: number) => ny * props.canvasHeight;

  const regionPx = {
    left: px(props.pageRegion.x),
    top: py(props.pageRegion.y),
    width: px(props.pageRegion.w),
    height: py(props.pageRegion.h),
  };

  const isStartPage = props.currentPage === props.ignore.startPage;
  const isEndPage = props.currentPage === (props.ignore.endPage ?? props.ignore.startPage);

  return (
    <div
      className={cn(
        "absolute border-2",
        props.interactive ? "pointer-events-auto" : "pointer-events-none",
        props.selected
          ? "border-red-500 bg-red-500/15"
          : "border-red-400/60 bg-red-500/10",
        props.isMultiPage && "border-dashed"
      )}
      style={{
        left: `${regionPx.left}px`,
        top: `${regionPx.top}px`,
        width: `${regionPx.width}px`,
        height: `${regionPx.height}px`,
        cursor: "pointer",
        backgroundImage: props.selected
          ? "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(239,68,68,0.08) 5px, rgba(239,68,68,0.08) 10px)"
          : "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(239,68,68,0.05) 5px, rgba(239,68,68,0.05) 10px)",
        borderTopStyle: !isStartPage ? "dashed" : undefined,
        borderBottomStyle: !isEndPage ? "dashed" : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
    >
      {/* Label (only on start page) */}
      {isStartPage && (
        <div
          className={cn(
            "absolute -top-6 left-0 px-1.5 py-0.5 text-xs text-white rounded-t",
            props.selected ? "bg-red-500" : "bg-red-400"
          )}
        >
          Ignore
          {props.isMultiPage ? ` (p${props.ignore.startPage}–${props.ignore.endPage})` : ""}
          <button
            className="ml-2 hover:text-red-200"
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete(props.ignore.id);
            }}
          >
            x
          </button>
        </div>
      )}

      {props.isMultiPage && !isStartPage && (
        <div className="absolute -top-5 left-0 text-xs text-gray-400">
          ...ignore from p{props.ignore.startPage}
        </div>
      )}
      {props.isMultiPage && !isEndPage && (
        <div className="absolute -bottom-5 left-0 text-xs text-gray-400">
          ignore continues...
        </div>
      )}
    </div>
  );
}
