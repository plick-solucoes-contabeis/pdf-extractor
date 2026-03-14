import { For } from "solid-js";

type DataTableProps = {
  data: string[][];
  maxCols: number;
  headerBg?: string;
  hoverBg?: string;
};

export function DataTable(props: DataTableProps) {
  const headerBg = () => props.headerBg ?? "bg-gray-100";
  const hoverBg = () => props.hoverBg ?? "hover:bg-gray-50";

  return (
    <table class="w-full text-xs border-collapse">
      <thead class={`sticky top-0 z-10 ${headerBg()}`}>
        <tr>
          <th class="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium">#</th>
          <For each={Array.from({ length: props.maxCols }, (_, i) => i)}>
            {(i) => (
              <th class="px-2 py-1 border-r border-b border-gray-200 text-left text-gray-500 font-medium">
                Col {i}
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={props.data}>
          {(row, rowIdx) => (
            <tr class={`border-b border-gray-100 ${hoverBg()}`}>
              <td class="px-2 py-1 border-r border-gray-100 text-gray-400">{rowIdx()}</td>
              <For each={row}>
                {(cell) => (
                  <td class="px-2 py-1 border-r border-gray-100 last:border-r-0 whitespace-nowrap">
                    {cell || "-"}
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
