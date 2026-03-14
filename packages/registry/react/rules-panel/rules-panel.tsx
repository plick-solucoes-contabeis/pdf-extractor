import React, { createContext, useContext, useCallback } from "react";
import type { PipelineRule, DataViewRules } from "@pdf-extractor/types";
import { cn } from "@pdf-extractor/utils";
import { Select } from "@pdf-extractor/ui/select";
import { RuleEditor } from "./rule-editors";

// --- Rule labels ---

const RULE_LABELS: Record<PipelineRule["type"], string> = {
  ignore_empty_lines: "Ignore empty lines",
  ignore_line: "Ignore line",
  merge_lines: "Merge lines",
  carry_forward: "Carry forward",
  transform_value: "Transform value",
  ignore_before_match: "Ignore before match",
  ignore_after_match: "Ignore after match",
};

// --- ID generation ---

let ruleIdCounter = 0;
function nextRuleId() {
  return `rule-${++ruleIdCounter}`;
}

// --- Context ---

type RulesPanelContextValue = {
  rules: PipelineRule[];
  onChange: (rules: PipelineRule[]) => void;
  updateRule: (index: number, patch: Partial<PipelineRule>) => void;
  removeRule: (index: number) => void;
  moveRule: (index: number, dir: -1 | 1) => void;
  addRule: (type: PipelineRule["type"]) => void;
};

const RulesPanelContext = createContext<RulesPanelContextValue | null>(null);

function useRulesPanel() {
  const ctx = useContext(RulesPanelContext);
  if (!ctx) throw new Error("RulesPanel compound components must be used within RulesPanel.Root");
  return ctx;
}

// --- Root ---

type RootProps = {
  rules: PipelineRule[];
  onChange: (rules: PipelineRule[]) => void;
  className?: string;
  children?: React.ReactNode;
};

function Root({ rules, onChange, className, children }: RootProps) {
  const updateRule = useCallback((index: number, patch: Partial<PipelineRule>) => {
    const arr = [...rules];
    arr[index] = { ...arr[index], ...patch } as PipelineRule;
    onChange(arr);
  }, [rules, onChange]);

  const removeRule = useCallback((index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  }, [rules, onChange]);

  const moveRule = useCallback((index: number, dir: -1 | 1) => {
    const arr = [...rules];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    onChange(arr);
  }, [rules, onChange]);

  const addRule = useCallback((type: PipelineRule["type"]) => {
    let rule: PipelineRule;
    switch (type) {
      case "ignore_empty_lines":
        rule = { type: "ignore_empty_lines", id: nextRuleId() };
        break;
      case "ignore_line":
        rule = { type: "ignore_line", id: nextRuleId(), conditions: [{ column: 0, matchType: "contains", value: "", caseInsensitive: false }], logic: "or" };
        break;
      case "merge_lines":
        rule = { type: "merge_lines", id: nextRuleId(), conditions: [], logic: "or", separator: " " };
        break;
      case "carry_forward":
        rule = { type: "carry_forward", id: nextRuleId(), column: 0 };
        break;
      case "transform_value":
        rule = { type: "transform_value", id: nextRuleId(), conditionColumn: 0, matchType: "contains", matchValue: "", caseInsensitive: false, targetColumn: 0, transform: { action: "set", value: "" } };
        break;
      case "ignore_before_match":
        rule = { type: "ignore_before_match", id: nextRuleId(), conditions: [{ column: 0, matchType: "contains", value: "", caseInsensitive: false }], inclusive: false };
        break;
      case "ignore_after_match":
        rule = { type: "ignore_after_match", id: nextRuleId(), conditions: [{ column: 0, matchType: "contains", value: "", caseInsensitive: false }], inclusive: false };
        break;
      default:
        return;
    }
    onChange([...rules, rule]);
  }, [rules, onChange]);

  const ctx: RulesPanelContextValue = {
    rules,
    onChange,
    updateRule,
    removeRule,
    moveRule,
    addRule,
  };

  return (
    <RulesPanelContext.Provider value={ctx}>
      <div className={cn("w-64 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-auto", className)}>
        {children ?? (
          <>
            <Header />
            <List />
          </>
        )}
      </div>
    </RulesPanelContext.Provider>
  );
}

// --- Header ---

type HeaderProps = {
  className?: string;
  children?: React.ReactNode;
};

function Header({ className, children }: HeaderProps) {
  return (
    <div className={cn("px-3 py-2 border-b border-gray-200 flex items-center justify-between", className)}>
      {children ?? (
        <>
          <span className="text-sm font-medium text-gray-700">Rules</span>
          <AddMenu />
        </>
      )}
    </div>
  );
}

// --- AddMenu ---

type AddMenuProps = {
  className?: string;
};

function AddMenu({ className }: AddMenuProps) {
  const { addRule } = useRulesPanel();

  return (
    <Select
      className={cn("text-xs border border-gray-300 rounded px-1.5 py-0.5", className)}
      value=""
      onChange={(e) => {
        const val = (e.target as HTMLSelectElement).value;
        if (val) addRule(val as PipelineRule["type"]);
        (e.target as HTMLSelectElement).value = "";
      }}
    >
      <option value="">Add rule...</option>
      <option value="ignore_empty_lines">Ignore empty lines</option>
      <option value="ignore_line">Ignore line by condition</option>
      <option value="merge_lines">Merge lines</option>
      <option value="carry_forward">Carry forward</option>
      <option value="transform_value">Transform value</option>
      <option value="ignore_before_match">Ignore before match</option>
      <option value="ignore_after_match">Ignore after match</option>
    </Select>
  );
}

// --- List ---

type ListProps = {
  className?: string;
  children?: (rule: PipelineRule, index: number) => React.ReactNode;
};

function List({ className, children }: ListProps) {
  const { rules } = useRulesPanel();

  if (rules.length === 0) {
    return (
      <div className={cn("p-3 flex flex-col gap-2 text-sm", className)}>
        <div className="text-xs text-gray-400 text-center py-4">
          No rules. Use "Add rule..." to get started.
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-3 flex flex-col gap-2 text-sm", className)}>
      {rules.map((rule, index) =>
        children ? children(rule, index) : <Card key={rule.id} rule={rule} index={index} />
      )}
    </div>
  );
}

// --- Card ---

type CardProps = {
  rule: PipelineRule;
  index: number;
  className?: string;
  children?: React.ReactNode;
};

function Card({ rule, index, className, children }: CardProps) {
  return (
    <div className={cn("p-2 bg-gray-50 rounded border border-gray-200 flex flex-col gap-1.5", className)}>
      {children ?? (
        <>
          <CardHeader rule={rule} index={index} />
          <CardEditor rule={rule} index={index} />
        </>
      )}
    </div>
  );
}

// --- Card.Header ---

type CardHeaderProps = {
  rule: PipelineRule;
  index: number;
  className?: string;
};

function CardHeader({ rule, index, className }: CardHeaderProps) {
  const { moveRule, removeRule } = useRulesPanel();

  return (
    <div className={cn("flex items-center justify-between", className)}>
      <span className="text-xs font-medium text-gray-500">
        {index + 1}. {RULE_LABELS[rule.type]}
      </span>
      <CardControls index={index} />
    </div>
  );
}

// --- Card.Editor ---

type CardEditorProps = {
  rule: PipelineRule;
  index: number;
  className?: string;
};

function CardEditor({ rule, index, className }: CardEditorProps) {
  const { updateRule } = useRulesPanel();

  return (
    <RuleEditor
      rule={rule}
      onUpdate={(patch) => updateRule(index, patch)}
      className={className}
    />
  );
}

// --- Card.Controls ---

type CardControlsProps = {
  index: number;
  className?: string;
};

function CardControls({ index, className }: CardControlsProps) {
  const { moveRule, removeRule } = useRulesPanel();

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        className="text-xs text-gray-400 hover:text-gray-700 px-0.5"
        onClick={() => moveRule(index, -1)}
        title="Move up"
      >
        ↑
      </button>
      <button
        className="text-xs text-gray-400 hover:text-gray-700 px-0.5"
        onClick={() => moveRule(index, 1)}
        title="Move down"
      >
        ↓
      </button>
      <button
        className="text-xs text-red-500 hover:text-red-700 px-0.5"
        onClick={() => removeRule(index)}
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

// --- Stats ---

type StatsProps = {
  inputCount: number;
  outputCount: number;
  className?: string;
};

function Stats({ inputCount, outputCount, className }: StatsProps) {
  if (inputCount <= 0) return null;
  return (
    <div className={cn("mt-2 text-xs text-gray-500 border-t border-gray-200 pt-2 px-3", className)}>
      Output: {outputCount}/{inputCount} rows
    </div>
  );
}

// --- Convenience wrapper ---

type RulesPanelSimpleProps = {
  rules: DataViewRules;
  onRulesChange: (rules: DataViewRules) => void;
  inputCount: number;
  outputCount: number;
  className?: string;
};

function RulesPanelSimple({ rules, onRulesChange, inputCount, outputCount, className }: RulesPanelSimpleProps) {
  return (
    <Root
      rules={rules.rules}
      onChange={(r) => onRulesChange({ rules: r })}
      className={className}
    >
      <Header />
      <List />
      <Stats inputCount={inputCount} outputCount={outputCount} />
    </Root>
  );
}

// --- Exports ---

export const RulesPanel = Object.assign(RulesPanelSimple, {
  Root,
  Header,
  AddMenu,
  List,
  Card: Object.assign(Card, {
    Header: CardHeader,
    Editor: CardEditor,
    Controls: CardControls,
  }),
  Stats,
});
