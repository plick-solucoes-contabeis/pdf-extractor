import React from "react";
import type { MatchCondition, IgnoreLineMatchType, MergeLineCondition, MergePatternPreset } from "@pdf-extractor/types";
import { MERGE_PATTERN_OPTIONS } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Input } from "@pdf-extractor/ui/input";
import { Select } from "@pdf-extractor/ui/select";
import { Checkbox } from "@pdf-extractor/ui/checkbox";
import { Label } from "@pdf-extractor/ui/label";

// --- Constants ---

export const MATCH_TYPES: { value: IgnoreLineMatchType; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "regex", label: "regex" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "index_eq", label: "line =" },
  { value: "index_lt", label: "line <" },
  { value: "index_lte", label: "line <=" },
  { value: "index_gt", label: "line >" },
  { value: "index_gte", label: "line >=" },
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
};

export function ConditionEditor({
  condition,
  onChange,
  onRemove,
  bgColor = "bg-red-50",
  borderColor = "border-red-200",
  className,
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
          <Label className="flex flex-col" style={{ width: 50 }}>
            <span className="text-[10px] text-gray-400">Col</span>
            <Input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
              value={condition.column}
              onChange={(e) => onChange({ column: parseInt((e.target as HTMLInputElement).value) || 0 })}
            />
          </Label>
        )}
        <Label className="flex flex-col flex-1">
          <span className="text-[10px] text-gray-400">Match</span>
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
            placeholder="Line number..."
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={condition.value}
            onChange={(e) => onChange({ value: (e.target as HTMLInputElement).value })}
          />
        ) : (
          <>
            <Input
              type="text"
              placeholder="Value..."
              className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
              value={condition.value}
              onChange={(e) => onChange({ value: (e.target as HTMLInputElement).value })}
            />
            <Label className="flex items-center gap-1 cursor-pointer">
              <Checkbox
                checked={condition.caseInsensitive}
                onChange={() => onChange({ caseInsensitive: !condition.caseInsensitive })}
              />
              <span className="text-[10px] text-gray-500">Case insensitive</span>
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
};

export function ConditionList({
  conditions,
  logic = "and",
  onChange,
  bgColor = "bg-red-50",
  borderColor = "border-red-200",
  buttonColor = "bg-red-600 hover:bg-red-700",
  buttonLabel = "+ Add Condition",
  className,
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
              — {logic === "and" ? "AND" : "OR"} —
            </div>
          )}
          <ConditionEditor
            condition={cond}
            onChange={(patch) => updateCondition(idx, patch)}
            onRemove={() => removeCondition(idx)}
            bgColor={bgColor}
            borderColor={borderColor}
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
};

export function MergeConditionEditor({
  condition,
  onChange,
  onRemove,
  className,
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
        <Label className="flex flex-col" style={{ width: 50 }}>
          <span className="text-[10px] text-gray-400">Col</span>
          <Input
            type="number"
            min={0}
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={condition.column}
            onChange={(e) => onChange({ column: parseInt((e.target as HTMLInputElement).value) || 0 })}
          />
        </Label>
        <Label className="flex flex-col flex-1">
          <span className="text-[10px] text-gray-400">matches</span>
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
};

export function MergeConditionList({
  conditions,
  logic,
  onChange,
  className,
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
              — {logic === "and" ? "AND" : "OR"} —
            </div>
          )}
          <MergeConditionEditor
            condition={cond}
            onChange={(patch) => updateCondition(idx, patch)}
            onRemove={() => removeCondition(idx)}
          />
        </React.Fragment>
      ))}
      <button
        className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={addCondition}
      >
        + Add Condition
      </button>
    </div>
  );
}
