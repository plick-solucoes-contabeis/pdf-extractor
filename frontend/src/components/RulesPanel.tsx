import { Index, Show, For, Switch, Match } from "solid-js";
import type { DataViewRules, PipelineRule, IgnoreLineMatchType, MergeLineCondition, MergePatternPreset } from "../types";
import { MERGE_PATTERN_OPTIONS } from "../lib/rules";

type RulesPanelProps = {
  rules: DataViewRules;
  onRulesChange: (rules: DataViewRules) => void;
  inputCount: number;
  outputCount: number;
};

const MATCH_TYPES: { value: IgnoreLineMatchType; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "equals", label: "equals" },
  { value: "regex", label: "regex" },
];

let ruleIdCounter = 0;
function nextRuleId() {
  return `rule-${++ruleIdCounter}`;
}

export function RulesPanel(props: RulesPanelProps) {
  function updateRules(rules: PipelineRule[]) {
    props.onRulesChange({ rules });
  }

  function updateRule(index: number, patch: Partial<PipelineRule>) {
    const arr = [...props.rules.rules];
    arr[index] = { ...arr[index], ...patch } as PipelineRule;
    updateRules(arr);
  }

  function removeRule(index: number) {
    updateRules(props.rules.rules.filter((_, i) => i !== index));
  }

  function moveRule(index: number, dir: -1 | 1) {
    const arr = [...props.rules.rules];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    updateRules(arr);
  }

  function addRule(type: string) {
    let rule: PipelineRule;
    switch (type) {
      case "ignore_empty_lines":
        rule = { type: "ignore_empty_lines", id: nextRuleId() };
        break;
      case "ignore_line":
        rule = { type: "ignore_line", id: nextRuleId(), column: 0, matchType: "contains", value: "", caseInsensitive: false };
        break;
      case "merge_lines":
        rule = { type: "merge_lines", id: nextRuleId(), conditions: [], separator: " " };
        break;
      default:
        return;
    }
    updateRules([...props.rules.rules, rule]);
  }

  function updateMergeCondition(ruleIndex: number, condIndex: number, patch: Partial<MergeLineCondition>) {
    const rule = props.rules.rules[ruleIndex];
    if (rule.type !== "merge_lines") return;
    const conditions = [...rule.conditions];
    conditions[condIndex] = { ...conditions[condIndex], ...patch };
    updateRule(ruleIndex, { conditions });
  }

  function removeMergeCondition(ruleIndex: number, condIndex: number) {
    const rule = props.rules.rules[ruleIndex];
    if (rule.type !== "merge_lines") return;
    updateRule(ruleIndex, { conditions: rule.conditions.filter((_, i) => i !== condIndex) });
  }

  function addMergeCondition(ruleIndex: number) {
    const rule = props.rules.rules[ruleIndex];
    if (rule.type !== "merge_lines") return;
    updateRule(ruleIndex, { conditions: [...rule.conditions, { column: 0, pattern: "has_value" }] });
  }

  const RULE_LABELS: Record<PipelineRule["type"], string> = {
    ignore_empty_lines: "Ignore empty lines",
    ignore_line: "Ignore line",
    merge_lines: "Merge lines",
  };

  return (
    <div class="w-64 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-auto">
      <div class="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700">Rules</span>
        <select
          class="text-xs border border-gray-300 rounded px-1.5 py-0.5"
          value=""
          onChange={(e) => {
            const val = e.currentTarget.value;
            if (val) addRule(val);
            e.currentTarget.value = "";
          }}
        >
          <option value="">Add rule...</option>
          <option value="ignore_empty_lines">Ignore empty lines</option>
          <option value="ignore_line">Ignore line by condition</option>
          <option value="merge_lines">Merge lines</option>
        </select>
      </div>

      <div class="p-3 flex flex-col gap-2 text-sm">
        <Index each={props.rules.rules}>
          {(rule, index) => (
            <div class="p-2 bg-gray-50 rounded border border-gray-200 flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-gray-500">
                  {index + 1}. {RULE_LABELS[rule().type]}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    class="text-xs text-gray-400 hover:text-gray-700 px-0.5"
                    onClick={() => moveRule(index, -1)}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    class="text-xs text-gray-400 hover:text-gray-700 px-0.5"
                    onClick={() => moveRule(index, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    class="text-xs text-red-500 hover:text-red-700 px-0.5"
                    onClick={() => removeRule(index)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>

              <Switch>
                <Match when={rule().type === "ignore_empty_lines"}>
                  <span class="text-xs text-gray-500">Removes rows where all cells are empty</span>
                </Match>

                <Match when={rule().type === "ignore_line"}>
                  <div class="flex flex-col gap-1.5">
                    <div class="flex gap-1">
                      <label class="flex flex-col flex-1">
                        <span class="text-[10px] text-gray-400">Column</span>
                        <input
                          type="number"
                          min="0"
                          class="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                          value={(rule() as PipelineRule & { type: "ignore_line" }).column}
                          onInput={(e) => updateRule(index, { column: parseInt(e.currentTarget.value) || 0 })}
                        />
                      </label>
                      <label class="flex flex-col flex-1">
                        <span class="text-[10px] text-gray-400">Match</span>
                        <select
                          class="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                          value={(rule() as PipelineRule & { type: "ignore_line" }).matchType}
                          onChange={(e) => updateRule(index, { matchType: e.currentTarget.value as IgnoreLineMatchType })}
                        >
                          <For each={MATCH_TYPES}>
                            {(mt) => <option value={mt.value}>{mt.label}</option>}
                          </For>
                        </select>
                      </label>
                    </div>
                    <input
                      type="text"
                      placeholder="Value..."
                      class="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                      value={(rule() as PipelineRule & { type: "ignore_line" }).value}
                      onInput={(e) => updateRule(index, { value: e.currentTarget.value })}
                    />
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(rule() as PipelineRule & { type: "ignore_line" }).caseInsensitive}
                        onChange={() => updateRule(index, { caseInsensitive: !(rule() as PipelineRule & { type: "ignore_line" }).caseInsensitive })}
                      />
                      <span class="text-[10px] text-gray-500">Case insensitive</span>
                    </label>
                  </div>
                </Match>

                <Match when={rule().type === "merge_lines"}>
                  <div class="flex flex-col gap-2">
                    <span class="text-[11px] text-gray-500">Start new row when:</span>
                    <Index each={(rule() as PipelineRule & { type: "merge_lines" }).conditions}>
                      {(cond, condIdx) => (
                        <>
                          <Show when={condIdx > 0}>
                            <div class="text-center text-[10px] text-gray-400 font-medium">— OR —</div>
                          </Show>
                          <div class="p-2 bg-blue-50 rounded border border-blue-200 flex flex-col gap-1.5">
                            <div class="flex items-center justify-end">
                              <button
                                class="text-xs text-red-500 hover:text-red-700"
                                onClick={() => removeMergeCondition(index, condIdx)}
                              >
                                ×
                              </button>
                            </div>
                            <div class="flex gap-1">
                              <label class="flex flex-col" style="width: 50px">
                                <span class="text-[10px] text-gray-400">Col</span>
                                <input
                                  type="number"
                                  min="0"
                                  class="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                                  value={cond().column}
                                  onInput={(e) => updateMergeCondition(index, condIdx, { column: parseInt(e.currentTarget.value) || 0 })}
                                />
                              </label>
                              <label class="flex flex-col flex-1">
                                <span class="text-[10px] text-gray-400">matches</span>
                                <select
                                  class="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                                  value={cond().pattern}
                                  onChange={(e) => {
                                    const pattern = e.currentTarget.value as MergePatternPreset | "regex";
                                    updateMergeCondition(index, condIdx, {
                                      pattern,
                                      regexValue: pattern === "regex" ? (cond().regexValue ?? "") : undefined,
                                    });
                                  }}
                                >
                                  <For each={MERGE_PATTERN_OPTIONS}>
                                    {(opt) => <option value={opt.value}>{opt.label}</option>}
                                  </For>
                                </select>
                              </label>
                            </div>
                            <Show when={cond().pattern === "regex"}>
                              <input
                                type="text"
                                placeholder="Regex..."
                                class="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                                value={cond().regexValue ?? ""}
                                onInput={(e) => updateMergeCondition(index, condIdx, { regexValue: e.currentTarget.value })}
                              />
                            </Show>
                          </div>
                        </>
                      )}
                    </Index>
                    <button
                      class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      onClick={() => addMergeCondition(index)}
                    >
                      + Add Condition
                    </button>
                    <label class="flex flex-col gap-0.5">
                      <span class="text-[10px] text-gray-400">Separator</span>
                      <input
                        type="text"
                        class="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                        value={(rule() as PipelineRule & { type: "merge_lines" }).separator}
                        onInput={(e) => updateRule(index, { separator: e.currentTarget.value })}
                      />
                    </label>
                  </div>
                </Match>
              </Switch>
            </div>
          )}
        </Index>

        <Show when={props.rules.rules.length === 0}>
          <div class="text-xs text-gray-400 text-center py-4">
            No rules. Use "Add rule..." to get started.
          </div>
        </Show>

        <Show when={props.inputCount > 0}>
          <div class="mt-2 text-xs text-gray-500 border-t border-gray-200 pt-2">
            Output: {props.outputCount}/{props.inputCount} rows
          </div>
        </Show>
      </div>
    </div>
  );
}
