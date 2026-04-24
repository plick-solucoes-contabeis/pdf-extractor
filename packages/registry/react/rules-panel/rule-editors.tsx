import React, { useMemo } from "react";
import type { PipelineRule, IgnoreLineMatchType, TransformAction, MatchCondition, MergeLineCondition, VariableTransformAction, PdfRegion } from "@pdf-extractor/types";
import { applyVariableTransforms } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Input } from "@pdf-extractor/ui/input";
import { Select } from "@pdf-extractor/ui/select";
import { Checkbox } from "@pdf-extractor/ui/checkbox";
import { Label } from "@pdf-extractor/ui/label";
import { ConditionList, MergeConditionList, MATCH_TYPES, isIndexMatch, needsValueField, ColumnSelect, ValueInput } from "./condition-editor";

// --- Common types ---

type RuleEditorProps<T extends PipelineRule> = {
  rule: T;
  onUpdate: (patch: Partial<T>) => void;
  className?: string;
  columnNames?: string[];
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
};

export function getColumnNames(rawData?: string[][], headerRow?: number | null): string[] {
  if (!rawData || rawData.length === 0) return [];
  const maxCols = rawData.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxCols === 0) return [];
  let labelRow: string[];
  if (headerRow != null && rawData[headerRow]) {
    labelRow = rawData[headerRow];
  } else {
    // Heuristic: pick the row with the most non-empty/non-dash cells
    labelRow = rawData[0];
    let bestCount = rawData[0].filter(c => c && c.trim() !== "" && c.trim() !== "-").length;
    for (let i = 1; i < Math.min(rawData.length, 10); i++) {
      const count = rawData[i].filter(c => c && c.trim() !== "" && c.trim() !== "-").length;
      if (count > bestCount) {
        bestCount = count;
        labelRow = rawData[i];
      }
    }
  }
  // Always return an entry for every column, falling back to empty string
  return Array.from({ length: maxCols }, (_, i) => labelRow[i] ?? "");
}

// --- Transform actions ---

const TRANSFORM_ACTIONS: { value: TransformAction["action"]; label: string }[] = [
  { value: "set", label: "Definir valor" },
  { value: "append_prefix", label: "Prefixar" },
  { value: "append_suffix", label: "Sufixar" },
  { value: "replace", label: "Substituir" },
];

// --- Editors ---

export function IgnoreEmptyLinesEditor({ className }: { className?: string }) {
  return (
    <span className={cn("text-xs text-gray-500", className)}>
      Remove linhas onde todas as células estão vazias
    </span>
  );
}

export function IgnoreLineEditor({ rule, onUpdate, className, columnNames = [], onCellPick, variableNames = [] }: RuleEditorProps<PipelineRule & { type: "ignore_line" }> & { variableNames?: string[] }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500">Ignorar linhas que correspondem:</span>
        <Select
          className="text-[10px] border border-gray-300 rounded px-1 py-0.5"
          value={rule.logic}
          onChange={(e) => onUpdate({ logic: (e.target as HTMLSelectElement).value as "or" | "and" })}
        >
          <option value="or">Qualquer (OU)</option>
          <option value="and">Todas (E)</option>
        </Select>
      </div>
      <ConditionList
        conditions={rule.conditions}
        logic={rule.logic}
        onChange={(conditions) => onUpdate({ conditions })}
        bgColor="bg-red-50"
        borderColor="border-red-200"
        buttonColor="bg-red-600 hover:bg-red-700"
        columnNames={columnNames}
        onCellPick={onCellPick}
        variableNames={variableNames}
      />
    </div>
  );
}

export function MergeLinesEditor({ rule, onUpdate, className, columnNames = [] }: RuleEditorProps<PipelineRule & { type: "merge_lines" }>) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500">Nova linha quando:</span>
        <Select
          className="text-[10px] border border-gray-300 rounded px-1 py-0.5"
          value={rule.logic}
          onChange={(e) => onUpdate({ logic: (e.target as HTMLSelectElement).value as "or" | "and" })}
        >
          <option value="or">Qualquer (OU)</option>
          <option value="and">Todas (E)</option>
        </Select>
      </div>
      <MergeConditionList
        conditions={rule.conditions}
        logic={rule.logic}
        onChange={(conditions) => onUpdate({ conditions })}
        columnNames={columnNames}
      />
      <Label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-gray-400">Separador</span>
        <Input
          type="text"
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
          value={rule.separator}
          onChange={(e) => onUpdate({ separator: (e.target as HTMLInputElement).value })}
        />
      </Label>
    </div>
  );
}

export function CarryForwardEditor({ rule, onUpdate, className, columnNames = [] }: RuleEditorProps<PipelineRule & { type: "carry_forward" }>) {
  const direction = rule.direction ?? "down";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs text-gray-500">
        {direction === "down"
          ? "Preenche células vazias com o último valor não vazio acima"
          : "Preenche células vazias com o próximo valor não vazio abaixo"}
      </span>
      <Label className="flex flex-col">
        <span className="text-[10px] text-gray-400">Coluna</span>
        <ColumnSelect
          value={rule.column}
          onChange={(col) => onUpdate({ column: col })}
          columnNames={columnNames}
        />
      </Label>
      <Label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={direction === "up"}
          onChange={(e) => onUpdate({ direction: (e.target as HTMLInputElement).checked ? "up" : "down" })}
        />
        <span className="text-xs text-gray-500">De baixo para cima</span>
      </Label>
    </div>
  );
}

export function TransformValueEditor({ rule, onUpdate, className, columnNames = [], onCellPick, variableNames = [] }: RuleEditorProps<PipelineRule & { type: "transform_value" }> & { variableNames?: string[] }) {
  function updateTransform(actionType: TransformAction["action"]) {
    let transform: TransformAction;
    switch (actionType) {
      case "set": transform = { action: "set", value: "" }; break;
      case "append_prefix": transform = { action: "append_prefix", value: "" }; break;
      case "append_suffix": transform = { action: "append_suffix", value: "" }; break;
      case "replace": transform = { action: "replace", search: "", replace: "" }; break;
    }
    onUpdate({ transform } as Partial<PipelineRule & { type: "transform_value" }>);
  }

  function updateTransformField(patch: Record<string, string>) {
    onUpdate({ transform: { ...rule.transform, ...patch } as TransformAction } as Partial<PipelineRule & { type: "transform_value" }>);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Condition */}
      <span className="text-[11px] text-gray-500 font-medium">Quando:</span>
      <div className="flex gap-1">
        {!isIndexMatch(rule.matchType) && (
          <Label className="flex flex-col" style={{ width: columnNames.length > 0 ? 100 : 50 }}>
            <span className="text-[10px] text-gray-400">Col</span>
            <ColumnSelect
              value={rule.conditionColumn}
              onChange={(col) => onUpdate({ conditionColumn: col })}
              columnNames={columnNames}
            />
          </Label>
        )}
        <Label className="flex flex-col flex-1">
          <span className="text-[10px] text-gray-400">Tipo</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={rule.matchType}
            onChange={(e) => onUpdate({ matchType: (e.target as HTMLSelectElement).value as IgnoreLineMatchType })}
          >
            {MATCH_TYPES.map((mt) => (
              <option key={mt.value} value={mt.value}>{mt.label}</option>
            ))}
          </Select>
        </Label>
      </div>
      {needsValueField(rule.matchType) && (
        isIndexMatch(rule.matchType) ? (
          <Input
            type="number"
            min={0}
            placeholder="Nº da linha..."
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={rule.matchValue}
            onChange={(e) => onUpdate({ matchValue: (e.target as HTMLInputElement).value })}
          />
        ) : (
          <>
            <ValueInput
              value={rule.matchValue}
              onChange={(val) => onUpdate({ matchValue: val })}
              onCellPick={onCellPick}
              variableNames={variableNames}
            />
            <Label className="flex items-center gap-1 cursor-pointer">
              <Checkbox
                checked={rule.caseInsensitive}
                onChange={() => onUpdate({ caseInsensitive: !rule.caseInsensitive })}
              />
              <span className="text-[10px] text-gray-500">Ignorar maiúsculas</span>
            </Label>
          </>
        )
      )}

      {/* Action */}
      <span className="text-[11px] text-gray-500 font-medium">Então:</span>
      <div className="flex gap-1">
        <Label className="flex flex-col" style={{ width: columnNames.length > 0 ? 100 : 50 }}>
          <span className="text-[10px] text-gray-400">Col</span>
          <ColumnSelect
            value={rule.targetColumn}
            onChange={(col) => onUpdate({ targetColumn: col })}
            columnNames={columnNames}
          />
        </Label>
        <Label className="flex flex-col flex-1">
          <span className="text-[10px] text-gray-400">Ação</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={rule.transform.action}
            onChange={(e) => updateTransform((e.target as HTMLSelectElement).value as TransformAction["action"])}
          >
            {TRANSFORM_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </Select>
        </Label>
      </div>
      {rule.transform.action === "replace" ? (
        <div className="flex gap-1">
          <ValueInput
            value={(rule.transform as TransformAction & { action: "replace" }).search}
            onChange={(val) => updateTransformField({ search: val })}
            placeholder="Buscar..."
            onCellPick={onCellPick}
            variableNames={variableNames}
            className="flex-1 min-w-0"
          />
          <ValueInput
            value={(rule.transform as TransformAction & { action: "replace" }).replace}
            onChange={(val) => updateTransformField({ replace: val })}
            placeholder="Substituir..."
            variableNames={variableNames}
            className="flex-1 min-w-0"
          />
        </div>
      ) : (
        <ValueInput
          value={(rule.transform as { value: string }).value}
          onChange={(val) => updateTransformField({ value: val })}
          onCellPick={onCellPick}
          variableNames={variableNames}
        />
      )}
    </div>
  );
}

export function IgnoreBeforeMatchEditor({ rule, onUpdate, className, columnNames = [], onCellPick, variableNames = [] }: RuleEditorProps<PipelineRule & { type: "ignore_before_match" }> & { variableNames?: string[] }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[11px] text-gray-500">Remover todas as linhas antes do primeiro match</span>
      <ConditionList
        conditions={rule.conditions}
        logic="and"
        onChange={(conditions) => onUpdate({ conditions })}
        bgColor="bg-amber-50"
        borderColor="border-amber-200"
        buttonColor="bg-amber-600 hover:bg-amber-700"
        columnNames={columnNames}
        onCellPick={onCellPick}
        variableNames={variableNames}
      />
      <Label className="flex items-center gap-1 cursor-pointer">
        <Checkbox
          checked={rule.inclusive}
          onChange={() => onUpdate({ inclusive: !rule.inclusive })}
        />
        <span className="text-[10px] text-gray-500">Remover também a linha correspondente</span>
      </Label>
    </div>
  );
}

export function IgnoreAfterMatchEditor({ rule, onUpdate, className, columnNames = [], onCellPick, variableNames = [] }: RuleEditorProps<PipelineRule & { type: "ignore_after_match" }> & { variableNames?: string[] }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[11px] text-gray-500">Remover todas as linhas depois do primeiro match</span>
      <ConditionList
        conditions={rule.conditions}
        logic="and"
        onChange={(conditions) => onUpdate({ conditions })}
        bgColor="bg-amber-50"
        borderColor="border-amber-200"
        buttonColor="bg-amber-600 hover:bg-amber-700"
        columnNames={columnNames}
        onCellPick={onCellPick}
        variableNames={variableNames}
      />
      <Label className="flex items-center gap-1 cursor-pointer">
        <Checkbox
          checked={rule.inclusive}
          onChange={() => onUpdate({ inclusive: !rule.inclusive })}
        />
        <span className="text-[10px] text-gray-500">Remover também a linha correspondente</span>
      </Label>
    </div>
  );
}

// --- Merge line above/below ---

type MergeLineRule = PipelineRule & { type: "merge_line_above" | "merge_line_below" };

export function MergeLineEditor({ rule, onUpdate, className, columnNames = [], onCellPick, variableNames = [] }: RuleEditorProps<MergeLineRule> & { variableNames?: string[] }) {
  const direction = rule.type === "merge_line_above" ? "acima" : "abaixo";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-xs text-gray-500">
        Mescla a linha com a linha {direction} quando ambas atendem as condições
      </span>

      {/* Source conditions */}
      <span className="text-[11px] text-gray-500 font-medium">Linha fonte (todas):</span>
      <ConditionList
        conditions={rule.sourceConditions}
        logic="and"
        onChange={(sourceConditions) => onUpdate({ sourceConditions } as Partial<MergeLineRule>)}
        bgColor="bg-violet-50"
        borderColor="border-violet-200"
        buttonColor="bg-violet-600 hover:bg-violet-700"
        buttonLabel="+ Condição fonte"
        columnNames={columnNames}
        onCellPick={onCellPick}
        variableNames={variableNames}
      />

      {/* Target conditions */}
      <span className="text-[11px] text-gray-500 font-medium">Linha alvo ({direction}) (todas):</span>
      {rule.targetConditions.length === 0 && (
        <span className="text-[10px] text-gray-400 italic">Sem condições — qualquer linha</span>
      )}
      <ConditionList
        conditions={rule.targetConditions}
        logic="and"
        onChange={(targetConditions) => onUpdate({ targetConditions } as Partial<MergeLineRule>)}
        bgColor="bg-teal-50"
        borderColor="border-teal-200"
        buttonColor="bg-teal-600 hover:bg-teal-700"
        buttonLabel="+ Condição alvo"
        columnNames={columnNames}
        variableNames={variableNames}
        onCellPick={onCellPick}
      />

      <Label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-gray-400">Separador</span>
        <Input
          type="text"
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
          value={rule.separator}
          onChange={(e) => onUpdate({ separator: (e.target as HTMLInputElement).value } as Partial<MergeLineRule>)}
        />
      </Label>
    </div>
  );
}

// --- Extract variable ---

const VARIABLE_TRANSFORM_ACTIONS: { value: VariableTransformAction["action"]; label: string }[] = [
  { value: "trim", label: "Remover espaços" },
  { value: "regex_extract", label: "Extrair com regex" },
  { value: "replace", label: "Substituir" },
  { value: "substring", label: "Substring" },
  { value: "uppercase", label: "Maiúsculas" },
  { value: "lowercase", label: "Minúsculas" },
  { value: "set", label: "Definir valor" },
  { value: "append_prefix", label: "Prefixar" },
  { value: "append_suffix", label: "Sufixar" },
];

function makeDefaultVariableTransform(action: VariableTransformAction["action"]): VariableTransformAction {
  switch (action) {
    case "trim": return { action: "trim" };
    case "uppercase": return { action: "uppercase" };
    case "lowercase": return { action: "lowercase" };
    case "regex_extract": return { action: "regex_extract", regex: "", group: 1 };
    case "replace": return { action: "replace", search: "", replace: "" };
    case "substring": return { action: "substring", start: 0 };
    case "set": return { action: "set", value: "" };
    case "append_prefix": return { action: "append_prefix", value: "" };
    case "append_suffix": return { action: "append_suffix", value: "" };
  }
}

export function VariableTransformRow({ transform, onChange, onRemove, variableNames = [] }: {
  transform: VariableTransformAction;
  onChange: (t: VariableTransformAction) => void;
  onRemove: () => void;
  variableNames?: string[];
}) {
  const hasValueField = transform.action === "set" || transform.action === "append_prefix" || transform.action === "append_suffix";
  return (
    <div className="flex flex-col gap-1 p-1.5 bg-white border border-gray-200 rounded">
      <div className="flex items-center gap-1">
        <Select
          className="flex-1 border border-gray-300 rounded px-1 py-0.5 text-[10px]"
          value={transform.action}
          onChange={(e) => onChange(makeDefaultVariableTransform((e.target as HTMLSelectElement).value as VariableTransformAction["action"]))}
        >
          {VARIABLE_TRANSFORM_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </Select>
        <button className="text-xs text-red-400 hover:text-red-600 px-0.5" onClick={onRemove}>×</button>
      </div>
      {transform.action === "regex_extract" && (
        <div className="flex gap-1">
          <Input
            type="text"
            placeholder="Regex..."
            className="flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-[10px]"
            value={transform.regex}
            onChange={(e) => onChange({ ...transform, regex: (e.target as HTMLInputElement).value })}
          />
          <Input
            type="number"
            min={0}
            placeholder="Grupo"
            className="w-12 border border-gray-300 rounded px-1.5 py-0.5 text-[10px]"
            value={transform.group}
            onChange={(e) => onChange({ ...transform, group: parseInt((e.target as HTMLInputElement).value) || 0 })}
          />
        </div>
      )}
      {transform.action === "replace" && (
        <div className="flex gap-1">
          <ValueInput
            value={transform.search}
            onChange={(v) => onChange({ ...transform, search: v })}
            placeholder="Buscar..."
            variableNames={variableNames}
            inputClassName="text-[10px]"
            className="flex-1 min-w-0"
          />
          <ValueInput
            value={transform.replace}
            onChange={(v) => onChange({ ...transform, replace: v })}
            placeholder="Por..."
            variableNames={variableNames}
            inputClassName="text-[10px]"
            className="flex-1 min-w-0"
          />
        </div>
      )}
      {transform.action === "substring" && (
        <div className="flex gap-1">
          <Input
            type="number"
            placeholder="Início"
            className="flex-1 min-w-0 border border-gray-300 rounded px-1.5 py-0.5 text-[10px]"
            value={transform.start}
            onChange={(e) => onChange({ ...transform, start: parseInt((e.target as HTMLInputElement).value) || 0 })}
          />
          <Input
            type="number"
            placeholder="Fim (opt)"
            className="flex-1 min-w-0 border border-gray-300 rounded px-1.5 py-0.5 text-[10px]"
            value={transform.end ?? ""}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              onChange({ ...transform, end: v === "" ? undefined : parseInt(v) });
            }}
          />
        </div>
      )}
      {hasValueField && (
        <ValueInput
          value={transform.value}
          onChange={(v) => onChange({ ...transform, value: v })}
          placeholder="Valor..."
          variableNames={variableNames}
          inputClassName="text-[10px]"
        />
      )}
    </div>
  );
}

export function ExtractVariableEditor({
  rule,
  onUpdate,
  onCellPick,
  onRegionPick,
  rawData,
  resolvedPdfValue,
  variableNames = [],
  className,
}: RuleEditorProps<PipelineRule & { type: "extract_variable" }> & {
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  onRegionPick?: (cb: (region: PdfRegion) => void) => void;
  rawData?: string[][];
  resolvedPdfValue?: string;
  variableNames?: string[];
}) {
  const [showPosition, setShowPosition] = React.useState(false);
  const transforms = rule.transforms ?? [];
  const source = rule.source ?? "table_cell";

  const tableCellRawValue = rawData?.[rule.row]?.[rule.col]?.trim() ?? "";
  const activeRawValue = source === "pdf_region" ? (resolvedPdfValue ?? "") : tableCellRawValue;

  const preview = useMemo(() => {
    if (!activeRawValue) return null;
    return applyVariableTransforms(activeRawValue, transforms);
  }, [activeRawValue, transforms]);

  const hasCell = rule.row !== 0 || rule.col !== 0 || tableCellRawValue !== "";
  const hasRegion = !!rule.region;

  function updateTransform(i: number, t: VariableTransformAction) {
    const next = [...transforms];
    next[i] = t;
    onUpdate({ transforms: next });
  }

  function removeTransform(i: number) {
    onUpdate({ transforms: transforms.filter((_, idx) => idx !== i) });
  }

  function addTransform() {
    onUpdate({ transforms: [...transforms, { action: "trim" }] });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Name */}
      <Label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-gray-400">Nome da variável</span>
        <Input
          type="text"
          placeholder="ex: year, account..."
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
          value={rule.name}
          onChange={(e) => onUpdate({ name: (e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9_]/g, "") })}
        />
      </Label>
      <span className="text-[10px] text-gray-400 -mt-1">Use como <code className="bg-gray-100 px-0.5 rounded">{"{{" + (rule.name || "nome") + "}}"}</code> nos mapeamentos</span>

      {/* Source toggle */}
      <Label className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Fonte</span>
          <div className="flex rounded overflow-hidden border border-gray-300 text-[10px]">
            <button
              className={cn("px-1.5 py-0.5", source === "table_cell" ? "bg-gray-200 text-gray-700 font-medium" : "bg-white text-gray-400 hover:bg-gray-50")}
              onClick={() => onUpdate({ source: "table_cell" } as any)}
            >
              Célula da tabela
            </button>
            <button
              className={cn("px-1.5 py-0.5", source === "pdf_region" ? "bg-orange-100 text-orange-700 font-medium" : "bg-white text-gray-400 hover:bg-gray-50")}
              onClick={() => onUpdate({ source: "pdf_region" } as any)}
            >
              Região do PDF
            </button>
          </div>
        </div>
      </Label>

      {source === "table_cell" && (
        /* Cell picker */
        <div className="flex flex-col gap-1">
          {onCellPick && (
            <button
              className="py-1 text-[10px] border border-purple-400 text-purple-600 rounded hover:bg-purple-50 font-medium"
              onClick={() => onCellPick((row, col) => { onUpdate({ row, col }); setShowPosition(false); })}
            >
              Selecionar célula
            </button>
          )}
          {hasCell && (
            <button
              className="text-[10px] text-gray-400 hover:text-gray-600 text-left"
              onClick={() => setShowPosition(v => !v)}
            >
              {showPosition ? "Ocultar posição" : `linha ${rule.row}, col ${rule.col}`}
            </button>
          )}
          {showPosition && (
            <div className="flex gap-1 items-end">
              <Label className="flex flex-col gap-0.5" style={{ width: 52 }}>
                <span className="text-[10px] text-gray-400">Linha</span>
                <Input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  value={rule.row}
                  onChange={(e) => onUpdate({ row: parseInt((e.target as HTMLInputElement).value) || 0 })}
                />
              </Label>
              <Label className="flex flex-col gap-0.5" style={{ width: 52 }}>
                <span className="text-[10px] text-gray-400">Col</span>
                <Input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  value={rule.col}
                  onChange={(e) => onUpdate({ col: parseInt((e.target as HTMLInputElement).value) || 0 })}
                />
              </Label>
            </div>
          )}
        </div>
      )}

      {source === "pdf_region" && (
        /* PDF region picker */
        <div className="flex flex-col gap-1">
          {onRegionPick && (
            <button
              className="py-1 text-[10px] border border-orange-400 text-orange-600 rounded hover:bg-orange-50 font-medium"
              onClick={() => onRegionPick((region) => { onUpdate({ region } as any); setShowPosition(false); })}
            >
              Selecionar região no PDF
            </button>
          )}
          {hasRegion && (
            <button
              className="text-[10px] text-gray-400 hover:text-gray-600 text-left"
              onClick={() => setShowPosition(v => !v)}
            >
              {showPosition ? "Ocultar posição" : `pág. ${rule.region!.page} | x:${(rule.region!.x * 100).toFixed(1)}% y:${(rule.region!.y * 100).toFixed(1)}%`}
            </button>
          )}
          {showPosition && hasRegion && (
            <div className="flex flex-col gap-1 p-1.5 bg-gray-50 border border-gray-200 rounded text-[10px] text-gray-500">
              <div className="grid grid-cols-2 gap-1">
                <span>Página: {rule.region!.page}</span>
                <span>Tolerância:</span>
                <span>x: {(rule.region!.x * 100).toFixed(2)}%</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-[10px]"
                  value={rule.tolerance ?? 10}
                  onChange={(e) => onUpdate({ tolerance: parseInt((e.target as HTMLInputElement).value) || 0 } as any)}
                />
                <span>y: {(rule.region!.y * 100).toFixed(2)}%</span>
                <span className="text-gray-400">px de margem</span>
                <span>w: {(rule.region!.w * 100).toFixed(2)}%</span>
                <span>h: {(rule.region!.h * 100).toFixed(2)}%</span>
              </div>
            </div>
          )}
          {!hasRegion && !onRegionPick && (
            <span className="text-[10px] text-gray-400 italic">Nenhuma região selecionada</span>
          )}
        </div>
      )}

      {/* Preview */}
      {activeRawValue !== "" && (
        <div className={cn("rounded border px-2 py-1.5 flex flex-col gap-0.5", source === "pdf_region" ? "border-orange-200 bg-orange-50" : "border-gray-200 bg-gray-50")}>
          <span className={cn("text-[10px]", source === "pdf_region" ? "text-orange-500" : "text-gray-400")}>
            {source === "pdf_region" ? "Texto capturado" : "Valor bruto"}
          </span>
          <span className="text-[10px] text-gray-600 font-mono break-all">{activeRawValue}</span>
          {transforms.length > 0 && (
            <>
              <span className="text-[10px] text-gray-400 mt-0.5">Preview</span>
              <span className={`text-[10px] font-mono break-all ${preview ? "text-green-700" : "text-gray-400 italic"}`}>
                {preview !== "" ? preview : "(vazio)"}
              </span>
            </>
          )}
        </div>
      )}

      {/* Transforms */}
      <span className="text-[11px] text-gray-500 font-medium">Pipeline de limpeza:</span>
      {transforms.length === 0 && (
        <span className="text-[10px] text-gray-400 italic">Nenhum transform — usa o valor bruto</span>
      )}
      {transforms.map((t, i) => (
        <VariableTransformRow
          key={i}
          transform={t}
          onChange={(next) => updateTransform(i, next)}
          onRemove={() => removeTransform(i)}
          variableNames={variableNames}
        />
      ))}
      <button
        className="text-[10px] text-indigo-600 hover:text-indigo-800 text-left"
        onClick={addTransform}
      >
        + Adicionar transform
      </button>
    </div>
  );
}

// --- Variable Transform Pipeline (reusable standalone) ---

export function VariableTransformPipeline({
  transforms,
  onChange,
  variableNames = [],
}: {
  transforms: VariableTransformAction[];
  onChange: (transforms: VariableTransformAction[]) => void;
  variableNames?: string[];
}) {
  function updateTransform(i: number, t: VariableTransformAction) {
    const next = [...transforms];
    next[i] = t;
    onChange(next);
  }

  function removeTransform(i: number) {
    onChange(transforms.filter((_, idx) => idx !== i));
  }

  function addTransform() {
    onChange([...transforms, { action: "trim" }]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-gray-500 font-medium">Pipeline de limpeza:</span>
      {transforms.length === 0 && (
        <span className="text-[10px] text-gray-400 italic">Nenhum transform — usa o valor bruto</span>
      )}
      {transforms.map((t, i) => (
        <VariableTransformRow
          key={i}
          transform={t}
          onChange={(next) => updateTransform(i, next)}
          onRemove={() => removeTransform(i)}
          variableNames={variableNames}
        />
      ))}
      <button
        className="text-[10px] text-indigo-600 hover:text-indigo-800 text-left"
        onClick={addTransform}
      >
        + Adicionar transform
      </button>
    </div>
  );
}

// --- Variable to column ---

export function VariableToColumnEditor({
  rule,
  onUpdate,
  onCellPick,
  rawData,
  className,
  columnNames: columnNamesProp,
  variableNames = [],
}: RuleEditorProps<PipelineRule & { type: "variable_to_column" }> & {
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  rawData?: string[][];
  variableNames?: string[];
}) {
  const columnNames = columnNamesProp ?? getColumnNames(rawData);
  const [showPosition, setShowPosition] = React.useState(false);
  const transforms = rule.transforms ?? [];

  const rawValue = rawData?.[rule.row]?.[rule.col]?.trim() ?? "";
  const preview = useMemo(() => {
    if (!rawValue) return null;
    return applyVariableTransforms(rawValue, transforms);
  }, [rawValue, transforms]);

  const hasCell = rule.row !== 0 || rule.col !== 0 || rawValue !== "";

  function updateTransform(i: number, t: VariableTransformAction) {
    const next = [...transforms];
    next[i] = t;
    onUpdate({ transforms: next });
  }

  function removeTransform(i: number) {
    onUpdate({ transforms: transforms.filter((_, idx) => idx !== i) });
  }

  function addTransform() {
    onUpdate({ transforms: [...transforms, { action: "trim" }] });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Cell picker */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-gray-400">Célula fonte</span>
        {onCellPick && (
          <button
            className="py-1 text-[10px] border border-purple-400 text-purple-600 rounded hover:bg-purple-50 font-medium"
            onClick={() => onCellPick((row, col) => { onUpdate({ row, col }); setShowPosition(false); })}
          >
            Selecionar célula
          </button>
        )}
        {hasCell && (
          <button
            className="text-[10px] text-gray-400 hover:text-gray-600 text-left"
            onClick={() => setShowPosition(v => !v)}
          >
            {showPosition ? "Ocultar posição" : `linha ${rule.row}, col ${rule.col}`}
          </button>
        )}
        {showPosition && (
          <div className="flex gap-1 items-end">
            <Label className="flex flex-col gap-0.5" style={{ width: 52 }}>
              <span className="text-[10px] text-gray-400">Linha</span>
              <Input
                type="number"
                min={0}
                className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                value={rule.row}
                onChange={(e) => onUpdate({ row: parseInt((e.target as HTMLInputElement).value) || 0 })}
              />
            </Label>
            <Label className="flex flex-col gap-0.5" style={{ width: 52 }}>
              <span className="text-[10px] text-gray-400">Col</span>
              <Input
                type="number"
                min={0}
                className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                value={rule.col}
                onChange={(e) => onUpdate({ col: parseInt((e.target as HTMLInputElement).value) || 0 })}
              />
            </Label>
          </div>
        )}
      </div>

      {/* Preview */}
      {rawValue !== "" && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 flex flex-col gap-0.5">
          <span className="text-[10px] text-amber-600">Valor</span>
          <span className="text-[10px] text-gray-700 font-mono break-all">{preview !== null ? preview : rawValue}</span>
        </div>
      )}
      {rawValue === "" && !onCellPick && (
        <span className="text-[10px] text-gray-400 italic">Selecione uma célula para começar</span>
      )}

      {/* Transforms */}
      <span className="text-[11px] text-gray-500 font-medium">Pipeline de limpeza:</span>
      {transforms.length === 0 && (
        <span className="text-[10px] text-gray-400 italic">Nenhum transform — usa o valor bruto</span>
      )}
      {transforms.map((t, i) => (
        <VariableTransformRow
          key={i}
          transform={t}
          onChange={(next) => updateTransform(i, next)}
          onRemove={() => removeTransform(i)}
          variableNames={variableNames}
        />
      ))}
      <button
        className="text-[10px] text-indigo-600 hover:text-indigo-800 text-left"
        onClick={addTransform}
      >
        + Adicionar transform
      </button>

      {/* Target column */}
      <div className="flex gap-1 items-end border-t border-gray-100 pt-2 mt-1">
        <Label className="flex flex-col gap-0.5" style={{ width: columnNames.length > 0 ? 100 : 52 }}>
          <span className="text-[10px] text-gray-400">Col. destino</span>
          <ColumnSelect
            value={rule.targetColumn}
            onChange={(col) => onUpdate({ targetColumn: col })}
            columnNames={columnNames}
          />
        </Label>
        <Label className="flex flex-col gap-0.5 flex-1">
          <span className="text-[10px] text-gray-400">Modo</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={rule.mode}
            onChange={(e) => onUpdate({ mode: (e.target as HTMLSelectElement).value as typeof rule.mode })}
          >
            <option value="set">Substituir</option>
            <option value="prepend">Prefixar</option>
            <option value="append">Sufixar</option>
          </Select>
        </Label>
      </div>
      {(rule.mode === "prepend" || rule.mode === "append") && (
        <Label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">Separador</span>
          <Input
            type="text"
            placeholder="ex: espaço, vírgula..."
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={rule.separator}
            onChange={(e) => onUpdate({ separator: (e.target as HTMLInputElement).value })}
          />
        </Label>
      )}
    </div>
  );
}

// --- Set column ---

export function SetColumnEditor({ rule, onUpdate, variableNames = [], className, columnNames = [] }: RuleEditorProps<PipelineRule & { type: "set_column" }> & { variableNames?: string[] }) {
  const isInsert = rule.mode === "insert_before" || rule.mode === "insert_after";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex gap-1">
        <Label className="flex flex-col gap-0.5" style={{ width: columnNames.length > 0 ? 100 : 52 }}>
          <span className="text-[10px] text-gray-400">Coluna</span>
          <ColumnSelect
            value={rule.column}
            onChange={(col) => onUpdate({ column: col })}
            columnNames={columnNames}
          />
        </Label>
        <Label className="flex flex-col gap-0.5 flex-1">
          <span className="text-[10px] text-gray-400">Modo</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={rule.mode}
            onChange={(e) => onUpdate({ mode: (e.target as HTMLSelectElement).value as typeof rule.mode })}
          >
            <option value="set">Substituir</option>
            <option value="prepend">Prefixar</option>
            <option value="append">Sufixar</option>
            <option value="insert_before">Nova coluna antes</option>
            <option value="insert_after">Nova coluna depois</option>
          </Select>
        </Label>
      </div>

      <ValueInput
        label="Valor"
        value={rule.value}
        onChange={(v) => onUpdate({ value: v })}
        fixedPlaceholder="Texto fixo..."
        variableNames={variableNames}
      />

      {!isInsert && (rule.mode === "prepend" || rule.mode === "append") && (
        <Label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">Separador</span>
          <Input
            type="text"
            placeholder="ex: espaço, vírgula..."
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={rule.separator}
            onChange={(e) => onUpdate({ separator: (e.target as HTMLInputElement).value })}
          />
        </Label>
      )}
    </div>
  );
}

// --- Capture group value ---

export function CaptureGroupValueEditor({
  rule,
  onUpdate,
  className,
  columnNames = [],
  onCellPick,
  variableNames = [],
}: RuleEditorProps<PipelineRule & { type: "capture_group_value" }> & { variableNames?: string[] }) {
  const transforms = rule.transforms ?? [];

  function updateTransform(i: number, t: VariableTransformAction) {
    const next = [...transforms];
    next[i] = t;
    onUpdate({ transforms: next });
  }

  function removeTransform(i: number) {
    onUpdate({ transforms: transforms.filter((_, idx) => idx !== i) });
  }

  function addTransform() {
    onUpdate({ transforms: [...transforms, { action: "trim" }] });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Header conditions */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 font-medium">Capturar quando:</span>
        <Select
          className="text-[10px] border border-gray-300 rounded px-1 py-0.5"
          value={rule.headerConditionsLogic}
          onChange={(e) => onUpdate({ headerConditionsLogic: (e.target as HTMLSelectElement).value as "or" | "and" })}
        >
          <option value="or">Qualquer (OU)</option>
          <option value="and">Todas (E)</option>
        </Select>
      </div>
      <ConditionList
        conditions={rule.headerConditions}
        logic={rule.headerConditionsLogic}
        onChange={(headerConditions) => onUpdate({ headerConditions })}
        bgColor="bg-amber-50"
        borderColor="border-amber-200"
        buttonColor="bg-amber-600 hover:bg-amber-700"
        buttonLabel="+ Condição de cabeçalho"
        columnNames={columnNames}
        onCellPick={onCellPick}
        variableNames={variableNames}
      />

      {/* Source column + transforms */}
      <div className="flex gap-1 items-end">
        <Label className="flex flex-col gap-0.5" style={{ width: columnNames.length > 0 ? 100 : 72 }}>
          <span className="text-[10px] text-gray-400">Coluna fonte</span>
          <ColumnSelect
            value={rule.sourceColumn}
            onChange={(col) => onUpdate({ sourceColumn: col })}
            columnNames={columnNames}
          />
        </Label>
      </div>

      <span className="text-[11px] text-gray-500 font-medium">Pipeline de limpeza:</span>
      {transforms.length === 0 && (
        <span className="text-[10px] text-gray-400 italic">Nenhum transform — usa o valor bruto</span>
      )}
      {transforms.map((t, i) => (
        <VariableTransformRow
          key={i}
          transform={t}
          onChange={(next) => updateTransform(i, next)}
          onRemove={() => removeTransform(i)}
          variableNames={variableNames}
        />
      ))}
      <button
        className="text-[10px] text-indigo-600 hover:text-indigo-800 text-left"
        onClick={addTransform}
      >
        + Adicionar transform
      </button>

      <div className="border-t border-gray-100 my-1" />

      {/* Target conditions */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 font-medium">Aplicar em:</span>
        <Select
          className="text-[10px] border border-gray-300 rounded px-1 py-0.5"
          value={rule.targetConditionsLogic}
          onChange={(e) => onUpdate({ targetConditionsLogic: (e.target as HTMLSelectElement).value as "or" | "and" })}
        >
          <option value="or">Qualquer (OU)</option>
          <option value="and">Todas (E)</option>
        </Select>
      </div>
      {rule.targetConditions.length === 0 && (
        <span className="text-[10px] text-gray-400 italic">Sem condições — todas as linhas abaixo recebem o valor</span>
      )}
      <ConditionList
        conditions={rule.targetConditions}
        logic={rule.targetConditionsLogic}
        onChange={(targetConditions) => onUpdate({ targetConditions })}
        bgColor="bg-teal-50"
        borderColor="border-teal-200"
        buttonColor="bg-teal-600 hover:bg-teal-700"
        buttonLabel="+ Condição de destino"
        columnNames={columnNames}
        onCellPick={onCellPick}
        variableNames={variableNames}
      />

      {/* Target column + mode */}
      <div className="flex gap-1 items-end">
        <Label className="flex flex-col gap-0.5" style={{ width: columnNames.length > 0 ? 100 : 72 }}>
          <span className="text-[10px] text-gray-400">Col. destino</span>
          <ColumnSelect
            value={rule.targetColumn}
            onChange={(col) => onUpdate({ targetColumn: col })}
            columnNames={columnNames}
          />
        </Label>
        <Label className="flex flex-col gap-0.5 flex-1">
          <span className="text-[10px] text-gray-400">Modo</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={rule.mode}
            onChange={(e) => onUpdate({ mode: (e.target as HTMLSelectElement).value as typeof rule.mode })}
          >
            <option value="set">Substituir</option>
            <option value="prepend">Prefixar</option>
            <option value="append">Sufixar</option>
          </Select>
        </Label>
      </div>

      {(rule.mode === "prepend" || rule.mode === "append") && (
        <Label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">Separador</span>
          <Input
            type="text"
            placeholder="ex: espaço, vírgula..."
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={rule.separator}
            onChange={(e) => onUpdate({ separator: (e.target as HTMLInputElement).value })}
          />
        </Label>
      )}

      {/* Remove header line */}
      <Label className="flex items-center gap-1.5 cursor-pointer">
        <Checkbox
          checked={rule.removeHeaderLine}
          onChange={() => onUpdate({ removeHeaderLine: !rule.removeHeaderLine })}
        />
        <span className="text-[10px] text-gray-600">Remover linha de cabeçalho do output</span>
      </Label>
    </div>
  );
}

// --- Editor dispatcher ---

export function RuleEditor({ rule, onUpdate, onCellPick, onRegionPick, rawData, originalData, headerRow, variableNames, resolvedPdfVariables, className }: { rule: PipelineRule; onUpdate: (patch: Partial<PipelineRule>) => void; onCellPick?: (cb: (row: number, col: number, value: string) => void) => void; onRegionPick?: (cb: (region: PdfRegion) => void) => void; rawData?: string[][]; originalData?: string[][]; headerRow?: number | null; variableNames?: string[]; resolvedPdfVariables?: Record<string, string>; className?: string }) {
  const columnNames = getColumnNames(originalData ?? rawData, headerRow);
  switch (rule.type) {
    case "ignore_empty_lines":
      return <IgnoreEmptyLinesEditor className={className} />;
    case "ignore_line":
      return <IgnoreLineEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} onCellPick={onCellPick} variableNames={variableNames} />;
    case "merge_lines":
      return <MergeLinesEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} />;
    case "carry_forward":
      return <CarryForwardEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} />;
    case "transform_value":
      return <TransformValueEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} onCellPick={onCellPick} variableNames={variableNames} />;
    case "ignore_before_match":
      return <IgnoreBeforeMatchEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} onCellPick={onCellPick} variableNames={variableNames} />;
    case "ignore_after_match":
      return <IgnoreAfterMatchEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} onCellPick={onCellPick} variableNames={variableNames} />;
    case "remove_empty_columns":
      return <span className={cn("text-xs text-gray-500", className)}>Remove colunas onde todas as células estão vazias</span>;
    case "merge_line_above":
    case "merge_line_below":
      return <MergeLineEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} onCellPick={onCellPick} variableNames={variableNames} />;
    case "extract_variable": {
      const resolvedPdfValue = (rule.source === "pdf_region" && rule.region && resolvedPdfVariables)
        ? resolvedPdfVariables[rule.name]
        : undefined;
      return <ExtractVariableEditor rule={rule} onUpdate={onUpdate as any} onCellPick={onCellPick} onRegionPick={onRegionPick} rawData={rawData} resolvedPdfValue={resolvedPdfValue} variableNames={variableNames} className={className} />;
    }
    case "set_column":
      return <SetColumnEditor rule={rule} onUpdate={onUpdate as any} variableNames={variableNames} className={className} columnNames={columnNames} />;
    case "variable_to_column":
      return <VariableToColumnEditor rule={rule} onUpdate={onUpdate as any} onCellPick={onCellPick} rawData={rawData} variableNames={variableNames} className={className} columnNames={columnNames} />;
    case "capture_group_value":
      return <CaptureGroupValueEditor rule={rule} onUpdate={onUpdate as any} className={className} columnNames={columnNames} onCellPick={onCellPick} variableNames={variableNames} />;
  }
}
