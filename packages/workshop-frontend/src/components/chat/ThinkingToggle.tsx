// Extended-thinking control for the composer. A lightbulb turns thinking off or back on, and a
// selector shows the level the chat will actually run at.
//
// The supported set comes from the backend (getModelThinkingLevels), which derives it from the
// same pi catalog the request path consults, so this never offers a level that would be rejected.
// Three rules keep the display honest -- each one exists because its absence was a real bug:
//
//  - "Default" is a first-class, selectable state, not a blank. An unset level does NOT mean
//    "high"; it means the per-API default (medium for OpenAI Responses, and no extended thinking
//    at all for non-adaptive Anthropic models). Rendering a concrete level there told users
//    high-effort reasoning was running when it was not, and left no way to undo a choice.
//  - A stored level the current model does not support is displayed as Default, because that is
//    what the request will effectively do once pi clamps it. Switching models must never leave a
//    level showing that the new model cannot honor.
//  - The control never renders empty. A chat stuck at "off" on a model that cannot disable
//    thinking previously hid both the lightbulb and the selector, stranding the user with no way
//    to change it.

import { useMemo } from "react";
import { Lightbulb, CaretDown } from "@phosphor-icons/react";
import { DropdownMenu } from "@cloudflare/kumo";
import type { ThinkingLevel, ThinkingLevelChoice } from "@gadgets/workshop-shared/api";

// Weakest to strongest, and the menu's display order, so a model advertising an arbitrary subset
// still lists its levels sensibly.
const LEVEL_ORDER: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

const LEVEL_LABELS: Record<ThinkingLevelChoice, string> = {
  default: "Default",
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

export interface ThinkingToggleProps {
  // The chat's stored level. Undefined means no level is stored and the per-API default applies.
  level: ThinkingLevel | undefined;
  // Levels the selected model supports. Empty renders nothing.
  levels: ThinkingLevel[];
  // "default" clears the stored level; anything else stores that level.
  onChange: (choice: ThinkingLevelChoice) => void;
}

export function ThinkingToggle({ level, levels, onChange }: ThinkingToggleProps) {
  const graded = useMemo(
      () => LEVEL_ORDER.filter((candidate) => levels.includes(candidate)),
      [levels]);
  const canTurnOff = levels.includes("off");

  if (graded.length === 0) return null;

  // Clamp a stored level the current model cannot honor down to Default, so the display always
  // matches what the request will do.
  const supported = level !== undefined
      && (level === "off" ? canTurnOff : graded.includes(level));
  const effective = supported ? level : undefined;
  const isOff = effective === "off";

  // Turning thinking back on returns to Default rather than guessing a level: Default is a real,
  // meaningful state here, and inventing "high" would reintroduce the display/reality mismatch.
  const lightbulbTarget: ThinkingLevelChoice = isOff ? "default" : "off";

  return (
    <div className="flex min-w-0 flex-shrink-0 items-center gap-0.5">
      {canTurnOff && (
        <button
          type="button"
          onClick={() => onChange(lightbulbTarget)}
          aria-pressed={!isOff}
          aria-label={isOff ? "Enable extended thinking" : "Disable extended thinking"}
          title={isOff
              ? "Extended thinking disabled - click to re-enable"
              : "Extended thinking enabled - click to disable"}
          className={`inline-flex h-8 flex-shrink-0 cursor-pointer items-center rounded-lg px-1.5 transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint focus-visible:bg-kumo-tint focus-visible:outline-none active:scale-[0.97] ${
              isOff ? "text-kumo-inactive hover:text-kumo-subtle" : "text-kumo-brand"}`}
        >
          <Lightbulb size={15} weight={isOff ? "regular" : "fill"} className="flex-shrink-0" />
        </button>
      )}
      {!isOff && (
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
                <span className="min-w-0 truncate">
                  {LEVEL_LABELS[effective ?? "default"]}
                </span>
                <CaretDown
                  size={12}
                  weight="bold"
                  className="flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180"
                />
              </button>
            }
          />
          <DropdownMenu.Content className="themed-floating-shadow-lg !z-[1100] !min-w-[130px] rounded-2xl border border-kumo-line/70 bg-kumo-base p-1">
            {(["default", ...graded] as ThinkingLevelChoice[]).map((candidate) => (
              <DropdownMenu.Item
                key={candidate}
                onClick={() => onChange(candidate)}
                className="!h-auto rounded-xl !px-2 !py-1.5 text-[12px] leading-4 font-normal tracking-[-0.15px] text-kumo-subtle transition-colors data-highlighted:bg-kumo-tint/70 data-highlighted:text-kumo-default"
              >
                <span className="min-w-0 flex-1 truncate">{LEVEL_LABELS[candidate]}</span>
                {candidate === (effective ?? "default") && (
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
