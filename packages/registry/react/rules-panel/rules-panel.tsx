import React, { createContext, useContext, useCallback, useState, useEffect, useRef, useMemo } from "react";
import type { PipelineRule, DataViewRules } from "@pdf-extractor/types";
import { applyDataViewRules } from "@pdf-extractor/rules";
import { cn } from "@pdf-extractor/utils";
import { Select } from "@pdf-extractor/ui/select";
import { RuleEditor } from "./rule-editors";

// --- Rule labels ---

const RULE_LABELS: Record<PipelineRule["type"], string> = {
  ignore_empty_lines: "Ignorar linhas vazias",
  ignore_line: "Ignorar linha",
  merge_lines: "Mesclar linhas",
  carry_forward: "Propagar valor",
  transform_value: "Transformar valor",
  ignore_before_match: "Ignorar antes",
  ignore_after_match: "Ignorar depois",
  remove_empty_columns: "Remover colunas vazias",
  merge_line_above: "Mesclar com linha acima",
  merge_line_below: "Mesclar com linha abaixo",
  extract_variable: "Extrair variável",
  set_column: "Definir coluna",
  variable_to_column: "Variável para coluna",
  capture_group_value: "Capturar valor de grupo",
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
  applyRules: () => void;
  dirty: boolean;
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  rawData?: string[][];
  headerRow: number | null;
  variableNames: string[];
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
  onLocalChange?: (rules: PipelineRule[]) => void;
  className?: string;
  children?: React.ReactNode;
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  rawData?: string[][];
  headerRow?: number | null;
};

function Root({ rules: externalRules, onChange, onLocalChange, className, children, onCellPick, rawData, headerRow = null }: RootProps) {
  const [localRules, setLocalRules] = useState(externalRules);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocalRules(externalRules);
    setDirty(false);
  }, [externalRules]);

  const localChange = useCallback((next: PipelineRule[]) => {
    setLocalRules(next);
    setDirty(true);
    onLocalChange?.(next);
  }, [onLocalChange]);

  const applyRules = useCallback(() => {
    onChange(localRules);
    setDirty(false);
  }, [localRules, onChange]);

  const updateRule = useCallback((index: number, patch: Partial<PipelineRule>) => {
    setLocalRules(prev => {
      const arr = [...prev];
      arr[index] = { ...arr[index], ...patch } as PipelineRule;
      onLocalChange?.(arr);
      return arr;
    });
    setDirty(true);
  }, [onLocalChange]);

  const removeRule = useCallback((index: number) => {
    setLocalRules(prev => {
      const next = prev.filter((_, i) => i !== index);
      onLocalChange?.(next);
      return next;
    });
    setDirty(true);
  }, [onLocalChange]);

  const moveRule = useCallback((index: number, dir: -1 | 1) => {
    setLocalRules(prev => {
      const arr = [...prev];
      const target = index + dir;
      if (target < 0 || target >= arr.length) return prev;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      onLocalChange?.(arr);
      return arr;
    });
    setDirty(true);
  }, [onLocalChange]);

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
      case "remove_empty_columns":
        rule = { type: "remove_empty_columns", id: nextRuleId() };
        break;
      case "merge_line_above":
        rule = { type: "merge_line_above", id: nextRuleId(), sourceConditions: [{ column: 0, matchType: "contains", value: "", caseInsensitive: false }], targetConditions: [], separator: " " };
        break;
      case "merge_line_below":
        rule = { type: "merge_line_below", id: nextRuleId(), sourceConditions: [{ column: 0, matchType: "contains", value: "", caseInsensitive: false }], targetConditions: [], separator: " " };
        break;
      case "extract_variable":
        rule = { type: "extract_variable", id: nextRuleId(), name: "", row: 0, col: 0, transforms: [] };
        break;
      case "set_column":
        rule = { type: "set_column", id: nextRuleId(), column: 0, mode: "set", value: "", separator: "" };
        break;
      case "variable_to_column":
        rule = { type: "variable_to_column", id: nextRuleId(), name: "", row: 0, col: 0, transforms: [], targetColumn: 0, mode: "set", separator: "" };
        break;
      case "capture_group_value":
        rule = { type: "capture_group_value", id: nextRuleId(), headerConditions: [{ column: 0, matchType: "contains", value: "", caseInsensitive: false }], headerConditionsLogic: "and", sourceColumn: 0, transforms: [], targetConditions: [], targetConditionsLogic: "and", targetColumn: 0, mode: "set", separator: "", removeHeaderLine: false };
        break;
      default:
        return;
    }
    setLocalRules(prev => {
      const next = [...prev, rule];
      onLocalChange?.(next);
      return next;
    });
    setDirty(true);
  }, []);

  const variableNames = localRules
    .filter((r): r is PipelineRule & { type: "extract_variable" } => r.type === "extract_variable")
    .map((r) => r.name)
    .filter((n) => n.trim() !== "");

  const ctx: RulesPanelContextValue = {
    rules: localRules,
    onChange: localChange,
    updateRule,
    removeRule,
    moveRule,
    addRule,
    applyRules,
    dirty,
    onCellPick,
    rawData,
    headerRow,
    variableNames,
  };

  return (
    <RulesPanelContext.Provider value={ctx}>
      <div className={cn("w-64 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden", className)}>
        {children ?? (
          <>
            <Header />
            <List />
            <Footer />
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
    <div className={cn("px-3 py-2 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0", className)}>
      {children ?? (
        <>
          <span className="text-sm font-medium text-gray-700">Regras</span>
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
      <option value="">Adicionar regra...</option>
      <option value="ignore_empty_lines">Ignorar linhas vazias</option>
      <option value="ignore_line">Ignorar linha por condição</option>
      <option value="merge_lines">Mesclar linhas</option>
      <option value="carry_forward">Propagar valor</option>
      <option value="transform_value">Transformar valor</option>
      <option value="ignore_before_match">Ignorar antes do match</option>
      <option value="ignore_after_match">Ignorar depois do match</option>
      <option value="remove_empty_columns">Remover colunas vazias</option>
      <option value="merge_line_above">Mesclar com linha acima</option>
      <option value="merge_line_below">Mesclar com linha abaixo</option>
      <option value="extract_variable">Extrair variável</option>
      <option value="set_column">Definir coluna</option>
      <option value="variable_to_column">Variável para coluna</option>
      <option value="capture_group_value">Capturar valor de grupo</option>
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
      <div className={cn("p-3 flex flex-col gap-2 text-sm flex-1 overflow-auto", className)}>
        <div className="text-xs text-gray-400 text-center py-4">
          Nenhuma regra. Use "Adicionar regra..." para começar.
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-3 flex flex-col gap-2 text-sm flex-1 overflow-auto", className)}>
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
  const { updateRule, onCellPick, rawData, headerRow, variableNames, rules } = useRulesPanel();

  const dataAtRule = useMemo(() => {
    if (!rawData || index === 0) return rawData;
    return applyDataViewRules(rawData, { rules: rules.slice(0, index) }).data;
  }, [rawData, rules, index]);

  return (
    <RuleEditor
      rule={rule}
      onUpdate={(patch) => updateRule(index, patch)}
      onCellPick={onCellPick}
      rawData={dataAtRule}
      headerRow={headerRow}
      variableNames={variableNames}
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
        title="Mover para cima"
      >
        ↑
      </button>
      <button
        className="text-xs text-gray-400 hover:text-gray-700 px-0.5"
        onClick={() => moveRule(index, 1)}
        title="Mover para baixo"
      >
        ↓
      </button>
      <button
        className="text-xs text-red-500 hover:text-red-700 px-0.5"
        onClick={() => removeRule(index)}
        title="Remover"
      >
        ×
      </button>
    </div>
  );
}

// --- Footer ---

type FooterProps = {
  className?: string;
  children?: React.ReactNode;
};

function Footer({ className, children }: FooterProps) {
  const { applyRules, dirty } = useRulesPanel();

  return (
    <div className={cn("px-3 py-2 shrink-0", className)}>
      {children ?? (
        <button
          className={cn(
            "w-full py-1.5 text-xs rounded text-white font-medium",
            dirty
              ? "bg-green-600 hover:bg-green-700"
              : "bg-gray-300 cursor-default"
          )}
          onClick={applyRules}
          disabled={!dirty}
        >
          Aplicar
        </button>
      )}
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
    <div className={cn("text-xs text-gray-500 pt-2 px-3", className)}>
      Saída: {outputCount}/{inputCount} linhas
    </div>
  );
}

// --- Convenience wrapper ---

type RulesPanelSimpleProps = {
  rules: DataViewRules;
  onRulesChange: (rules: DataViewRules) => void;
  onLocalRulesChange?: (rules: DataViewRules) => void;
  inputCount: number;
  outputCount: number;
  className?: string;
  onCellPick?: (cb: (row: number, col: number, value: string) => void) => void;
  rawData?: string[][];
  headerRow?: number | null;
};

function RulesPanelSimple({ rules, onRulesChange, onLocalRulesChange, inputCount, outputCount, className, onCellPick, rawData, headerRow }: RulesPanelSimpleProps) {
  return (
    <Root
      rules={rules.rules}
      onChange={(r) => onRulesChange({ rules: r })}
      onLocalChange={onLocalRulesChange ? (r) => onLocalRulesChange({ rules: r }) : undefined}
      className={className}
      onCellPick={onCellPick}
      rawData={rawData}
      headerRow={headerRow}
    >
      <Header />
      <List />
      <div className="shrink-0 border-t border-gray-200">
        <Stats inputCount={inputCount} outputCount={outputCount} />
        <Footer />
      </div>
    </Root>
  );
}

// --- Exports ---

export const RulesPanel = Object.assign(RulesPanelSimple, {
  Root,
  Header,
  AddMenu,
  List,
  Footer,
  Card: Object.assign(Card, {
    Header: CardHeader,
    Editor: CardEditor,
    Controls: CardControls,
  }),
  Stats,
});
