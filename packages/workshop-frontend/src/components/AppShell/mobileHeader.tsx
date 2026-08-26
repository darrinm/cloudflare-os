import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Below `md`, the shell's top bar is the app bar: hamburger, then the screen's header content,
 * then the connection chip. Screens supply that content through this slot; screens that don't get
 * a title derived from the route. One mechanism, one bar — so every phone screen pays for one
 * header row instead of stacking its own under a nearly-empty hamburger strip (~104px of chrome
 * before content, on every screen).
 *
 * The slot is a portal into a container the shell owns, not lifted React state: content re-renders
 * (a selected tab, a live chip) flow through the portal without touching the shell, and only
 * mount/unmount notify it — which is what suppresses the fallback title without render loops.
 *
 * Discipline: render at most one <MobileHeader> at a time per screen state. A screen with panes
 * that swap below `md` (roster → conversation) renders the one for the visible pane, not both.
 * At `md+` the slot renders nothing and screens show their own inline headers; the shell bar
 * stays the deliberate desktop chrome strip.
 */
export type MobileHeaderSlot = {
  /** The bar's slot element; null until the shell bar mounts (or at `md+`, where it never does). */
  container: HTMLElement | null
  /** Mount/unmount bookkeeping so the shell knows whether to show the fallback title. */
  onMount: () => () => void
}

export const MobileHeaderContext = createContext<MobileHeaderSlot | null>(null)

export function MobileHeader({ children }: { children: ReactNode }) {
  const slot = useContext(MobileHeaderContext)
  useEffect(() => (slot ? slot.onMount() : undefined), [slot])
  // No provider (tests render screens bare) or no container yet: contribute nothing.
  if (!slot?.container) return null
  return createPortal(children, slot.container)
}

// The viewport range where the bar presents. Matches the bar slot's `md:hidden` in AppShell
// (Tailwind `md` = 768px) — keep in step.
export const MOBILE_BAR_QUERY = '(max-width: 767.9px)'

/** The bar's one title typography. */
export function MobileHeaderTitle({ children, className = '' }: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 flex-1 truncate text-[15px] font-medium text-kumo-default ${className}`}>
      {children}
    </div>
  )
}

/**
 * The fallback: a screen that registers nothing is titled by its route. The static labels mirror
 * Sidebar's nav (keep them in step — they are seven short strings, not worth restructuring the
 * Sidebar's JSX into a shared config); gatekeeper app titles come from the same
 * useGatekeeperApps data Sidebar renders, so those cannot drift.
 */
export function routeTitle(
  pathname: string,
  gatekeeperApps: readonly { id: string; title: string }[],
  siteName: string,
): string {
  if (pathname === '/' || pathname === '') return siteName
  if (pathname.startsWith('/workspaces')) return 'Projects'
  if (pathname.startsWith('/blueprint')) return 'Templates'
  if (pathname.startsWith('/outputs')) return 'Apps'
  if (pathname.startsWith('/bots')) return 'Bots'
  if (pathname.startsWith('/explore')) return 'Explore'
  if (pathname.startsWith('/gatekeepers/')) {
    const id = decodeURIComponent(pathname.split('/')[2] ?? '')
    return gatekeeperApps.find((a) => a.id === id)?.title ?? 'Tools'
  }
  if (pathname.startsWith('/gatekeepers')) return 'Tools'
  if (pathname.startsWith('/context')) return 'Context & Skills'
  if (pathname.startsWith('/profile')) return 'Profile'
  if (pathname.startsWith('/admin')) return 'Admin'
  return siteName
}
