// Extended-thinking control for the composer: one menu listing the levels the selected model
// actually supports, plus "Default" and (where the model allows it) "Off".
//
// The supported set comes from the backend (getModelThinkingLevels), derived from the same pi
// catalog the request path consults, so this never offers a level that would be rejected. Two
// rules keep the display honest, each because its absence was a real bug:
//
//  - "Default" is a first-class, selectable state, not a blank. An unset level does NOT mean
//    "high"; it means the per-API default (medium for OpenAI Responses, no extended thinking at
//    all for non-adaptive Anthropic models). Rendering a concrete level there told users
//    high-effort reasoning was running when it was not, and left no way to undo a choice.
//  - A stored level the current model does not support is displayed as the level pi will clamp it
//    to, not as Default and not as the stored value. Showing either would state something the
//    request does not do.
//
// "Off" is an item in this menu rather than a separate toggle button. As two controls, a chat
// stored at "off" on a model that cannot disable thinking hid both of them and stranded the user
// with no way to change it; as one menu that is structurally impossible.

import { Lightbulb, CaretDown, Check } from "@phosphor-icons/react";
import { DropdownMenu } from "@cloudflare/kumo";
import type { ThinkingLevel, ThinkingLevelChoice } from "@gadgets/workshop-shared/api";
import { COMPOSER_MENU_CONTENT, COMPOSER_MENU_ITEM } from "../menuStyles";

// Weakest to strongest. Must mirror pi's EXTENDED_THINKING_LEVELS: clampLevel below reproduces
// pi's clampThinkingLevel, and the two only agree if they walk the same ladder. Also the order
// the backend returns supported levels in, so the menu needs no separate sort.
const LEVEL_LADDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

// Mirrors pi's clampThinkingLevel (models.js): exact match, else the nearest supported level
// searching stronger-first then weaker. Duplicated rather than imported because the frontend has
// no pi dependency -- but it must stay in step, since pi is what the request actually applies.
function clampLevel(level: ThinkingLevel, levels: ThinkingLevel[]): ThinkingLevel | undefined {
  if (levels.includes(level)) return level;
  const requested = LEVEL_LADDER.indexOf(level);
  if (requested === -1) return levels[0];
  for (let i = requested; i < LEVEL_LADDER.length; i++) {
    if (levels.includes(LEVEL_LADDER[i])) return LEVEL_LADDER[i];
  }
  for (let i = requested - 1; i >= 0; i--) {
    if (levels.includes(LEVEL_LADDER[i])) return LEVEL_LADDER[i];
  }
  return levels[0];
}

export interface ThinkingToggleProps {
  // The chat's stored level. Undefined means no level is stored and the per-API default applies.
  level: ThinkingLevel | undefined;
  // Levels the selected model supports, weakest first. Empty renders nothing.
  levels: ThinkingLevel[];
  // "default" clears the stored level; anything else stores that level.
  onChange: (choice: ThinkingLevelChoice) => void;
}

export function ThinkingToggle({ level, levels, onChange }: ThinkingToggleProps) {
  if (levels.length === 0) return null;

  // What this chat will actually run at, after pi's clamp.
  const effective = level === undefined ? undefined : clampLevel(level, levels);
  const selected: ThinkingLevelChoice = effective ?? "default";

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <button
            type="button"
            aria-label="Thinking effort level"
            title="How hard the model should think"
            className="group inline-flex h-8 min-w-0 flex-shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-[13px] leading-5 tracking-[-0.25px] text-kumo-subtle transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint hover:text-kumo-default focus-visible:bg-kumo-tint focus-visible:text-kumo-default focus-visible:outline-none active:scale-[0.97] data-[popup-open]:bg-kumo-tint data-[popup-open]:text-kumo-default"
          >
            <Lightbulb
              size={15}
              weight={effective === "off" ? "regular" : "fill"}
              className={`flex-shrink-0 ${
                  effective === "off" ? "text-kumo-inactive" : "text-kumo-brand"}`}
            />
            <span className="min-w-0 truncate">{LEVEL_LABELS[selected]}</span>
            <CaretDown
              size={12}
              weight="bold"
              className="flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180"
            />
          </button>
        }
      />
      <DropdownMenu.Content className={`${COMPOSER_MENU_CONTENT} !min-w-[130px]`}>
        {(["default", ...levels] as ThinkingLevelChoice[]).map((candidate) => (
          <DropdownMenu.Item
            key={candidate}
            onClick={() => onChange(candidate)}
            className={COMPOSER_MENU_ITEM}
          >
            <span className="min-w-0 flex-1 truncate">{LEVEL_LABELS[candidate]}</span>
            {candidate === selected && (
              <Check size={12} weight="bold" className="ml-3 flex-shrink-0 text-kumo-inactive" />
            )}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
