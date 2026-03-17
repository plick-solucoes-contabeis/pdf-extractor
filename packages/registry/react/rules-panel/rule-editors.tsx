import React from "react";
import type { PipelineRule, IgnoreLineMatchType, TransformAction, MatchCondition, MergeLineCondition } from "@pdf-extractor/types";
import { cn } from "@pdf-extractor/utils";
import { Input } from "@pdf-extractor/ui/input";
import { Select } from "@pdf-extractor/ui/select";
import { Checkbox } from "@pdf-extractor/ui/checkbox";
import { Label } from "@pdf-extractor/ui/label";
import { ConditionList, MergeConditionList, MATCH_TYPES, isIndexMatch, needsValueField } from "./condition-editor";

// --- Common types ---

type RuleEditorProps<T extends PipelineRule> = {
  rule: T;
  onUpdate: (patch: Partial<T>) => void;
  className?: string;
};

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

export function IgnoreLineEditor({ rule, onUpdate, className }: RuleEditorProps<PipelineRule & { type: "ignore_line" }>) {
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
      />
    </div>
  );
}

export function MergeLinesEditor({ rule, onUpdate, className }: RuleEditorProps<PipelineRule & { type: "merge_lines" }>) {
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

export function CarryForwardEditor({ rule, onUpdate, className }: RuleEditorProps<PipelineRule & { type: "carry_forward" }>) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs text-gray-500">Preenche células vazias com o último valor não vazio acima</span>
      <Label className="flex flex-col">
        <span className="text-[10px] text-gray-400">Coluna</span>
        <Input
          type="number"
          min={0}
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
          value={rule.column}
          onChange={(e) => onUpdate({ column: parseInt((e.target as HTMLInputElement).value) || 0 })}
        />
      </Label>
    </div>
  );
}

export function TransformValueEditor({ rule, onUpdate, className }: RuleEditorProps<PipelineRule & { type: "transform_value" }>) {
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
          <Label className="flex flex-col" style={{ width: 50 }}>
            <span className="text-[10px] text-gray-400">Col</span>
            <Input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
              value={rule.conditionColumn}
              onChange={(e) => onUpdate({ conditionColumn: parseInt((e.target as HTMLInputElement).value) || 0 })}
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
            <Input
              type="text"
              placeholder="Valor..."
              className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
              value={rule.matchValue}
              onChange={(e) => onUpdate({ matchValue: (e.target as HTMLInputElement).value })}
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
        <Label className="flex flex-col" style={{ width: 50 }}>
          <span className="text-[10px] text-gray-400">Col</span>
          <Input
            type="number"
            min={0}
            className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={rule.targetColumn}
            onChange={(e) => onUpdate({ targetColumn: parseInt((e.target as HTMLInputElement).value) || 0 })}
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
          <Input
            type="text"
            placeholder="Buscar..."
            className="flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={(rule.transform as TransformAction & { action: "replace" }).search}
            onChange={(e) => updateTransformField({ search: (e.target as HTMLInputElement).value })}
          />
          <Input
            type="text"
            placeholder="Substituir..."
            className="flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
            value={(rule.transform as TransformAction & { action: "replace" }).replace}
            onChange={(e) => updateTransformField({ replace: (e.target as HTMLInputElement).value })}
          />
        </div>
      ) : (
        <Input
          type="text"
          placeholder="Valor..."
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
          value={(rule.transform as { value: string }).value}
          onChange={(e) => updateTransformField({ value: (e.target as HTMLInputElement).value })}
        />
      )}
    </div>
  );
}

export function IgnoreBeforeMatchEditor({ rule, onUpdate, className }: RuleEditorProps<PipelineRule & { type: "ignore_before_match" }>) {
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

export function IgnoreAfterMatchEditor({ rule, onUpdate, className }: RuleEditorProps<PipelineRule & { type: "ignore_after_match" }>) {
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

// --- Editor dispatcher ---

export function RuleEditor({ rule, onUpdate, className }: { rule: PipelineRule; onUpdate: (patch: Partial<PipelineRule>) => void; className?: string }) {
  switch (rule.type) {
    case "ignore_empty_lines":
      return <IgnoreEmptyLinesEditor className={className} />;
    case "ignore_line":
      return <IgnoreLineEditor rule={rule} onUpdate={onUpdate as any} className={className} />;
    case "merge_lines":
      return <MergeLinesEditor rule={rule} onUpdate={onUpdate as any} className={className} />;
    case "carry_forward":
      return <CarryForwardEditor rule={rule} onUpdate={onUpdate as any} className={className} />;
    case "transform_value":
      return <TransformValueEditor rule={rule} onUpdate={onUpdate as any} className={className} />;
    case "ignore_before_match":
      return <IgnoreBeforeMatchEditor rule={rule} onUpdate={onUpdate as any} className={className} />;
    case "ignore_after_match":
      return <IgnoreAfterMatchEditor rule={rule} onUpdate={onUpdate as any} className={className} />;
    case "remove_empty_columns":
      return <span className={cn("text-xs text-gray-500", className)}>Remove colunas onde todas as células estão vazias</span>;
  }
}
