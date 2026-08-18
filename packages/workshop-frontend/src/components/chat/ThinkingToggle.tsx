// Extended-thinking control for the composer: one menu of Default, Off (where the model allows
// it), and the levels the selected model supports. Levels come from the backend, derived from the
// same pi catalog the request path uses, so this can't offer something pi would reject.
//
// Two rules, each because its absence was a real bug:
//  - "Default" is a selectable state, not a blank. Unset does NOT mean "high" -- it means the
//    per-API default (medium for OpenAI, no extended thinking at all for non-adaptive Anthropic).
//  - A stored level the model doesn't support displays as what pi will clamp it to, not as the
//    stored value and not as Default.
//
// "Off" is a menu item rather than a separate toggle: as two controls, a chat stored at "off" on
// a model that can't disable thinking hid both and stranded the user.

import { Lightbulb, CaretDown, Check } from "@phosphor-icons/react";
import { DropdownMenu } from "@cloudflare/kumo";
import type { ThinkingLevel, ThinkingLevelChoice } from "@gadgets/workshop-shared/api";
import { COMPOSER_MENU_CONTENT, COMPOSER_MENU_ITEM } from "../menuStyles";

// Must mirror pi's EXTENDED_THINKING_LEVELS -- clampLevel below reproduces pi's clamp, and the
// two only agree walking the same ladder. Also the order the backend returns levels in.
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

// Mirrors pi's clampThinkingLevel: exact match, else nearest supported, stronger-first. Copied
// rather than imported (no pi dependency here), so it must stay in step with pi.
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
  /** Undefined = nothing stored, per-API default applies. */
  level: ThinkingLevel | undefined;
  /** Weakest first. Empty renders nothing. */
  levels: ThinkingLevel[];
  /** "default" clears; anything else stores. */
  onChange: (choice: ThinkingLevelChoice) => void;
}

export function ThinkingToggle({ level, levels, onChange }: ThinkingToggleProps) {
  if (levels.length === 0) return null;

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
