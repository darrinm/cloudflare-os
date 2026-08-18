/**
 * Shared styling for kebab / overflow DropdownMenu menus, so every list (sidebar rows, Workspaces,
 * Blueprints, AI providers) uses the same compact, on-language menu instead of Kumo's larger
 * defaults. Kept tight (13px rows, small padding) to match the rest of the design system.
 * `outline-none`: the popup takes DOM focus when it opens, and the UA focus ring around the whole
 * panel adds nothing (the highlighted row already shows where you are) while fighting the border.
 */
export const MENU_CONTENT =
  'themed-floating-shadow !z-[1100] !min-w-[180px] rounded-lg border border-kumo-line bg-kumo-base p-1 outline-none focus:outline-none focus-visible:outline-none'

/**
 * Kumo portals the menu to document.body and applies MENU_CONTENT's className to the *inner* popup,
 * not the portaled positioner wrapper that actually stacks against the page. Without a z-index on
 * that wrapper the whole menu sits at the auto layer and slips behind fixed overlays like the mobile
 * sidebar drawer (z-50). Pass this as `style` on <DropdownMenu.Content> so the positioner lifts to
 * the same dropdown tier as MENU_CONTENT.
 */
export const MENU_POSITIONER_STYLE = { zIndex: 1100 } as const

export const MENU_ITEM =
  '!h-auto rounded-md !px-2.5 !py-1.5 text-[14px] md:text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default data-highlighted:bg-kumo-tint'

export const MENU_ITEM_DANGER =
  '!h-auto rounded-md !px-2.5 !py-1.5 text-[14px] md:text-[13px] leading-[18px] tracking-[-0.25px] data-highlighted:bg-kumo-danger-tint'

/**
 * The composer's menu variant: rounder and softer than the kebab menus above, matching the
 * rounded composer surface these open from. The model picker in ChatInterface.tsx still inlines
 * these same strings; new composer menus should use these constants rather than copy them again.
 */
export const COMPOSER_MENU_CONTENT =
  'themed-floating-shadow-lg !z-[1100] rounded-2xl border border-kumo-line/70 bg-kumo-base p-1'

export const COMPOSER_MENU_ITEM =
  '!h-auto rounded-xl !px-2 !py-1.5 text-[13px] md:text-[12px] leading-4 font-normal tracking-[-0.15px] text-kumo-subtle transition-colors data-highlighted:bg-kumo-tint/70 data-highlighted:text-kumo-default'
