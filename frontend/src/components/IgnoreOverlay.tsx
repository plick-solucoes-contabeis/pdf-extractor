import { Show } from "solid-js";
import type { IgnoreAnnotation, Rect } from "../types";

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

  const regionPx = () => ({
    left: px(props.pageRegion.x),
    top: py(props.pageRegion.y),
    width: px(props.pageRegion.w),
    height: py(props.pageRegion.h),
  });

  const isStartPage = () => props.currentPage === props.ignore.startPage;
  const isEndPage = () => props.currentPage === (props.ignore.endPage ?? props.ignore.startPage);

  return (
    <div
      class={`absolute ${props.interactive ? "pointer-events-auto" : "pointer-events-none"} border-2 ${
        props.selected
          ? "border-red-500 bg-red-500/15"
          : "border-red-400/60 bg-red-500/10"
      } ${props.isMultiPage ? "border-dashed" : ""}`}
      style={{
        left: `${regionPx().left}px`,
        top: `${regionPx().top}px`,
        width: `${regionPx().width}px`,
        height: `${regionPx().height}px`,
        cursor: "pointer",
        // hatched pattern
        "background-image": props.selected
          ? "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(239,68,68,0.08) 5px, rgba(239,68,68,0.08) 10px)"
          : "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(239,68,68,0.05) 5px, rgba(239,68,68,0.05) 10px)",
        "border-top-style": !isStartPage() ? "dashed" : undefined,
        "border-bottom-style": !isEndPage() ? "dashed" : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
    >
      {/* Label (only on start page) */}
      <Show when={isStartPage()}>
        <div
          class={`absolute -top-6 left-0 px-1.5 py-0.5 text-xs text-white rounded-t ${
            props.selected ? "bg-red-500" : "bg-red-400"
          }`}
        >
          Ignore
          {props.isMultiPage ? ` (p${props.ignore.startPage}–${props.ignore.endPage})` : ""}
          <button
            class="ml-2 hover:text-red-200"
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete(props.ignore.id);
            }}
          >
            x
          </button>
        </div>
      </Show>

      <Show when={props.isMultiPage && !isStartPage()}>
        <div class="absolute -top-5 left-0 text-xs text-gray-400">
          ...ignore from p{props.ignore.startPage}
        </div>
      </Show>
      <Show when={props.isMultiPage && !isEndPage()}>
        <div class="absolute -bottom-5 left-0 text-xs text-gray-400">
          ignore continues...
        </div>
      </Show>
    </div>
  );
}
