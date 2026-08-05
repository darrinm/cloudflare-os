// Extended-thinking control for the composer. A lightbulb button turns thinking on or off, and
// when it is on a level selector appears next to it with a dropdown of the levels the selected
// model actually supports.
//
// The supported set comes from the backend (getModelThinkingLevels), which derives it from the
// same pi catalog the request path consults -- so this never offers a level that would be
// rejected. Two consequences worth knowing:
//
//  - A model with no graded levels renders nothing at all, rather than a knob that silently does
//    nothing. Same for models pi does not know (uncataloged ids, ollama).
//  - A model that cannot turn thinking off (Anthropic's adaptive-only models, where a disabled
//    thinking request is an error) gets no lightbulb -- only the level selector. Showing an
//    off switch that the provider rejects would be worse than showing none.

import { useMemo } from "react";
import { Lightbulb, CaretDown } from "@phosphor-icons/react";
import { DropdownMenu } from "@cloudflare/kumo";
import type { ThinkingLevelChoice } from "@gadgets/workshop-shared/api";

// Weakest to strongest. Also the display order in the menu, so a model advertising an arbitrary
// subset still lists its levels in a sensible order.
const LEVEL_ORDER: ThinkingLevelChoice[] = [
  "minimal", "low", "medium", "high", "xhigh", "max",
];

const LEVEL_LABELS: Record<ThinkingLevelChoice, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

export interface ThinkingToggleProps {
  // The chat's current level. Undefined means the deployment default is in effect (adaptive for
  // Anthropic, medium for OpenAI Responses) -- shown as the strongest sensible level rather than
  // as an empty selector, because that is what the request actually does.
  level: ThinkingLevelChoice | undefined;
  // Levels the selected model supports. Empty renders nothing.
  levels: ThinkingLevelChoice[];
  onChange: (level: ThinkingLevelChoice) => void;
}

export function ThinkingToggle({ level, levels, onChange }: ThinkingToggleProps) {
  const graded = useMemo(
      () => LEVEL_ORDER.filter((candidate) => levels.includes(candidate)),
      [levels]);
  const canTurnOff = levels.includes("off");

  // What the lightbulb turns thinking back *on* to. "high" when available (matching Iris's
  // default), otherwise the strongest level the model offers.
  const defaultOn = graded.includes("high") ? "high" : graded[graded.length - 1];

  if (graded.length === 0) return null;

  const isOff = level === "off";
  // An unset level means the provider default is running, which is a thinking turn -- so the
  // control reads as on, at the level the menu would pick.
  const shown = isOff ? undefined : (level ?? defaultOn);

  return (
    <div className="flex min-w-0 flex-shrink-0 items-center gap-0.5">
      {canTurnOff && (
        <button
          type="button"
          onClick={() => onChange(isOff ? defaultOn : "off")}
          aria-pressed={!isOff}
          aria-label={isOff ? "Enable extended thinking" : "Disable extended thinking"}
          title={isOff
              ? "Enable extended thinking for deeper reasoning"
              : "Extended thinking enabled - click to disable"}
          className={`inline-flex h-8 flex-shrink-0 cursor-pointer items-center rounded-lg px-1.5 transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint focus-visible:bg-kumo-tint focus-visible:outline-none active:scale-[0.97] ${
              isOff ? "text-kumo-inactive hover:text-kumo-subtle" : "text-kumo-brand"}`}
        >
          <Lightbulb size={15} weight={isOff ? "regular" : "fill"} className="flex-shrink-0" />
        </button>
      )}
      {shown !== undefined && (
        <DropdownMenu>
          <DropdownMenu.Trigger
            render={
              <button
                type="button"
                aria-label="Thinking effort level"
                title="How hard the model should think"
                className="group inline-flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-[13px] leading-5 tracking-[-0.25px] text-kumo-subtle transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint hover:text-kumo-default focus-visible:bg-kumo-tint focus-visible:text-kumo-default focus-visible:outline-none active:scale-[0.97] data-[popup-open]:bg-kumo-tint data-[popup-open]:text-kumo-default"
              >
                {!canTurnOff && (
                  <Lightbulb size={15} weight="fill" className="flex-shrink-0 text-kumo-brand" />
                )}
                <span className="min-w-0 truncate">{LEVEL_LABELS[shown]}</span>
                <CaretDown
                  size={12}
                  weight="bold"
                  className="flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180"
                />
              </button>
            }
          />
          <DropdownMenu.Content className="themed-floating-shadow-lg !z-[1100] !min-w-[120px] rounded-2xl border border-kumo-line/70 bg-kumo-base p-1">
            {graded.map((candidate) => (
              <DropdownMenu.Item
                key={candidate}
                onClick={() => onChange(candidate)}
                className="!h-auto rounded-xl !px-2 !py-1.5 text-[12px] leading-4 font-normal tracking-[-0.15px] text-kumo-subtle transition-colors data-highlighted:bg-kumo-tint/70 data-highlighted:text-kumo-default"
              >
                <span className="min-w-0 flex-1 truncate">{LEVEL_LABELS[candidate]}</span>
                {candidate === shown && (
                  <span aria-hidden className="ml-2 flex-shrink-0 text-kumo-brand">&#10003;</span>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu>
      )}
    </div>
  );
}
