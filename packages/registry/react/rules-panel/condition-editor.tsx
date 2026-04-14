import React from "react";
import type { MatchCondition, IgnoreLineMatchType, MergeLineCondition, MergePatternPreset } from "@pdf-extractor/types";
import { MERGE_PATTERN_OPTIONS } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Input } from "@pdf-extractor/ui/input";
import { Select } from "@pdf-extractor/ui/select";
import { Checkbox } from "@pdf-extractor/ui/checkbox";
import { Label } from "@pdf-extractor/ui/label";

// --- ValueInput ---
// Padrão canônico para todos os campos de valor no sistema.
// Toggle exclusivo Fixo | Variável: modo Fixo = input livre, modo Variável = select com {{nome}}.
// Quando variableNames está vazio, renderiza só o input (sem toggle).

type ValueInputProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  fixedPlaceholder?: string;
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  variableNames?: string[];
  className?: string;
  inputClassName?: string;
};

export function ValueInput({
  value,
  onChange,
  label,
  placeholder,
  fixedPlaceholder,
  onCellPick,
  variableNames = [],
  className,
  inputClassName,
}: ValueInputProps) {
  const varMatch = value.match(/^\{\{(\w+)\}\}$/);
  const [mode, setMode] = React.useState<"fixed" | "variable">(varMatch ? "variable" : "fixed");

  function handleModeSwitch(next: "fixed" | "variable") {
    setMode(next);
    if (next === "variable" && variableNames.length > 0) {
      onChange(`{{${variableNames[0]}}}`);
    } else if (next === "fixed") {
      onChange("");
    }
  }

  const hasVars = variableNames.length > 0;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(label || hasVars) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-[10px] text-gray-400">{label}</span>}
          {hasVars && (
            <div className="flex rounded overflow-hidden border border-gray-300 text-[10px]">
              <button
                type="button"
                className={cn("px-1.5 py-0.5", mode === "fixed" ? "bg-gray-200 text-gray-700 font-medium" : "bg-white text-gray-400 hover:bg-gray-50")}
                onClick={() => handleModeSwitch("fixed")}
              >
                Fixo
              </button>
              <button
                type="button"
                className={cn("px-1.5 py-0.5", mode === "variable" ? "bg-indigo-100 text-indigo-700 font-medium" : "bg-white text-gray-400 hover:bg-gray-50")}
                onClick={() => handleModeSwitch("variable")}
              >
                Variável
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "variable" ? (
        <Select
          className={cn("w-full border border-gray-300 rounded px-1 py-0.5 text-xs", inputClassName)}
          value={varMatch?.[1] ?? variableNames[0]}
          onChange={(e) => onChange(`{{${(e.target as HTMLSelectElement).value}}}`)}
        >
          {variableNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Select>
      ) : (
        <div className="flex gap-1 items-center">
          <Input
            type="text"
            placeholder={fixedPlaceholder ?? placeholder ?? "Valor..."}
            className={cn("flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-xs", inputClassName)}
            value={value}
            onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          />
          {onCellPick && (
            <button
              type="button"
              title="Clicar em uma célula para capturar o valor (ESC para cancelar)"
              className="shrink-0 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded p-0.5 transition-colors"
              onClick={() => onCellPick((_row, _col, val) => onChange(val))}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** @deprecated Use ValueInput instead */
export function ValuePickerInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; onCellPick?: (cb: (row: number, col: number, value: string) => void) => void; variableNames?: string[]; className?: string }) {
  return <ValueInput {...props} />;
}

// --- ColumnSelect ---

type ColumnSelectProps = {
  value: number;
  onChange: (col: number) => void;
  columnNames: string[];
  className?: string;
};

export function ColumnSelect({ value, onChange, columnNames, className }: ColumnSelectProps) {
  if (columnNames.length === 0) {
    return (
      <Input
        type="number"
        min={0}
        className={className ?? "w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"}
        value={value}
        onChange={(e) => onChange(parseInt((e.target as HTMLInputElement).value) || 0)}
      />
    );
  }
  return (
    <Select
      className={className ?? "w-full border border-gray-300 rounded px-1 py-0.5 text-xs"}
      value={value}
      onChange={(e) => onChange(parseInt((e.target as HTMLSelectElement).value) || 0)}
    >
      {columnNames.map((name, i) => (
        <option key={i} value={i}>{i}: {name}</option>
      ))}
    </Select>
  );
}

// --- Constants ---

export const MATCH_TYPES: { value: IgnoreLineMatchType; label: string }[] = [
  { value: "contains", label: "contém" },
  { value: "not_contains", label: "não contém" },
  { value: "starts_with", label: "começa com" },
  { value: "ends_with", label: "termina com" },
  { value: "equals", label: "igual a" },
  { value: "not_equals", label: "diferente de" },
  { value: "regex", label: "regex" },
  { value: "is_empty", label: "está vazio" },
  { value: "is_not_empty", label: "não está vazio" },
  { value: "index_eq", label: "linha =" },
  { value: "index_lt", label: "linha <" },
  { value: "index_lte", label: "linha <=" },
  { value: "index_gt", label: "linha >" },
  { value: "index_gte", label: "linha >=" },
];

export function isIndexMatch(matchType: string) {
  return matchType.startsWith("index_");
}

export function needsValueField(matchType: string) {
  return matchType !== "is_empty" && matchType !== "is_not_empty";
}

// --- ConditionEditor ---

type ConditionEditorProps = {
  condition: MatchCondition;
  onChange: (patch: Partial<MatchCondition>) => void;
  onRemove: () => void;
  bgColor?: string;
  borderColor?: string;
  className?: string;
  columnNames?: string[];
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  variableNames?: string[];
};

export function ConditionEditor({
  condition,
  onChange,
  onRemove,
  bgColor = "bg-red-50",
  borderColor = "border-red-200",
  className,
  columnNames = [],
  onCellPick,
  variableNames = [],
}: ConditionEditorProps) {
  return (
    <div className={cn("p-2 rounded border flex flex-col gap-1.5", bgColor, borderColor, className)}>
      <div className="flex items-center justify-end">
        <button
          className="text-xs text-red-500 hover:text-red-700"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <div className="flex gap-1">
        {!isIndexMatch(condition.matchType) && (
          <Label className="flex flex-col" style={{ width: columnNames.length > 0 ? 100 : 50 }}>
            <span className="text-[10px] text-gray-400">Col</span>
            <ColumnSelect
              value={condition.column}
              onChange={(col) => onChange({ column: col })}
              columnNames={columnNames}
            />
          </Label>
        )}
        <Label className="flex flex-col flex-1">
          <span className="text-[10px] text-gray-400">Tipo</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={condition.matchType}
            onChange={(e) => onChange({ matchType: (e.target as HTMLSelectElement).value as IgnoreLineMatchType })}
          >
            {MATCH_TYPES.map((mt) => (
              <option key={mt.value} value={mt.value}>{mt.label}</option>
            ))}
          </Select>
        </Label>
      </div>
      {needsValueField(condition.matchType) && (
        isIndexMatch(condition.matchType) ? (
          <Input
            type="number"
            min={0}
            placeholder="Nº da linha..."
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={condition.value}
            onChange={(e) => onChange({ value: (e.target as HTMLInputElement).value })}
          />
        ) : (
          <>
            <ValueInput
              value={condition.value}
              onChange={(val) => onChange({ value: val })}
              onCellPick={onCellPick}
              variableNames={variableNames}
            />
            <Label className="flex items-center gap-1 cursor-pointer">
              <Checkbox
                checked={condition.caseInsensitive}
                onChange={() => onChange({ caseInsensitive: !condition.caseInsensitive })}
              />
              <span className="text-[10px] text-gray-500">Ignorar maiúsculas</span>
            </Label>
          </>
        )
      )}
    </div>
  );
}

// --- ConditionList ---

type ConditionListProps = {
  conditions: MatchCondition[];
  logic?: "or" | "and";
  onChange: (conditions: MatchCondition[]) => void;
  bgColor?: string;
  borderColor?: string;
  buttonColor?: string;
  buttonLabel?: string;
  className?: string;
  columnNames?: string[];
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  variableNames?: string[];
};

export function ConditionList({
  conditions,
  logic = "and",
  onChange,
  bgColor = "bg-red-50",
  borderColor = "border-red-200",
  buttonColor = "bg-red-600 hover:bg-red-700",
  buttonLabel = "+ Adicionar Condição",
  className,
  columnNames = [],
  onCellPick,
  variableNames = [],
}: ConditionListProps) {
  function updateCondition(index: number, patch: Partial<MatchCondition>) {
    const updated = [...conditions];
    updated[index] = { ...updated[index], ...patch };
    onChange(updated);
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function addCondition() {
    onChange([...conditions, { column: 0, matchType: "contains", value: "", caseInsensitive: false }]);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {conditions.map((cond, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && (
            <div className="text-center text-[10px] text-gray-400 font-medium">
              — {logic === "and" ? "E" : "OU"} —
            </div>
          )}
          <ConditionEditor
            condition={cond}
            onChange={(patch) => updateCondition(idx, patch)}
            onRemove={() => removeCondition(idx)}
            bgColor={bgColor}
            borderColor={borderColor}
            columnNames={columnNames}
            onCellPick={onCellPick}
            variableNames={variableNames}
          />
        </React.Fragment>
      ))}
      <button
        className={cn("px-2 py-1 text-xs text-white rounded", buttonColor)}
        onClick={addCondition}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

// --- MergeConditionEditor ---

type MergeConditionEditorProps = {
  condition: MergeLineCondition;
  onChange: (patch: Partial<MergeLineCondition>) => void;
  onRemove: () => void;
  className?: string;
  columnNames?: string[];
};

export function MergeConditionEditor({
  condition,
  onChange,
  onRemove,
  className,
  columnNames = [],
}: MergeConditionEditorProps) {
  return (
    <div className={cn("p-2 bg-blue-50 rounded border border-blue-200 flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-end">
        <button
          className="text-xs text-red-500 hover:text-red-700"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <div className="flex gap-1">
        <Label className="flex flex-col" style={{ width: columnNames.length > 0 ? 100 : 50 }}>
          <span className="text-[10px] text-gray-400">Col</span>
          <ColumnSelect
            value={condition.column}
            onChange={(col) => onChange({ column: col })}
            columnNames={columnNames}
          />
        </Label>
        <Label className="flex flex-col flex-1">
          <span className="text-[10px] text-gray-400">corresponde</span>
          <Select
            className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
            value={condition.pattern}
            onChange={(e) => {
              const pattern = (e.target as HTMLSelectElement).value as MergePatternPreset | "regex";
              onChange({
                pattern,
                regexValue: pattern === "regex" ? (condition.regexValue ?? "") : undefined,
              });
            }}
          >
            {MERGE_PATTERN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </Label>
      </div>
      {condition.pattern === "regex" && (
        <Input
          type="text"
          placeholder="Regex..."
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
          value={condition.regexValue ?? ""}
          onChange={(e) => onChange({ regexValue: (e.target as HTMLInputElement).value })}
        />
      )}
    </div>
  );
}

// --- MergeConditionList ---

type MergeConditionListProps = {
  conditions: MergeLineCondition[];
  logic: "or" | "and";
  onChange: (conditions: MergeLineCondition[]) => void;
  className?: string;
  columnNames?: string[];
};

export function MergeConditionList({
  conditions,
  logic,
  onChange,
  className,
  columnNames = [],
}: MergeConditionListProps) {
  function updateCondition(index: number, patch: Partial<MergeLineCondition>) {
    const updated = [...conditions];
    updated[index] = { ...updated[index], ...patch };
    onChange(updated);
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function addCondition() {
    onChange([...conditions, { column: 0, pattern: "has_value" }]);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {conditions.map((cond, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && (
            <div className="text-center text-[10px] text-gray-400 font-medium">
              — {logic === "and" ? "E" : "OU"} —
            </div>
          )}
          <MergeConditionEditor
            condition={cond}
            onChange={(patch) => updateCondition(idx, patch)}
            onRemove={() => removeCondition(idx)}
            columnNames={columnNames}
          />
        </React.Fragment>
      ))}
      <button
        className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={addCondition}
      >
        + Adicionar Condição
      </button>
    </div>
  );
}
