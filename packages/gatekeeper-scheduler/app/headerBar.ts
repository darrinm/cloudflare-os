// Whether the host's phone app bar is presenting this app's header actions (see
// workshop-shared/header-actions). While true the page hides its own header block; the host
// pushes changes as the viewport crosses its breakpoint.

let presented = false;
const listeners = new Set<() => void>();

export function setHeaderPresented(next: boolean): void {
  if (presented === next) return;
  presented = next;
  listeners.forEach((listener) => listener());
}

export function getHeaderPresented(): boolean {
  return presented;
}

export function subscribeHeaderPresented(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
