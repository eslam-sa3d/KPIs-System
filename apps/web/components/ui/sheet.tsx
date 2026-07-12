"use client"

import AtlaskitBlanket from "@atlaskit/blanket"
import { createContext, useContext, useEffect, type ReactNode } from "react"

/** Atlaskit has no published slide-out-drawer component — this composes
 *  @atlaskit/blanket (the same scrim primitive Modal itself uses) with a
 *  plain fixed-position panel styled from the app's existing elevation/
 *  radius/border tokens, the same "custom composition on real Atlaskit
 *  tokens" approach used for Card. */
type SheetContextValue = { onOpenChange: (open: boolean) => void }
const SheetContext = createContext<SheetContextValue | null>(null)

function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange: (open: boolean) => void
  children?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  if (!open) return null
  return <SheetContext.Provider value={{ onOpenChange }}>{children}</SheetContext.Provider>
}

function SheetContent({ children }: { children?: ReactNode; className?: string }) {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error("<SheetContent> must be used inside <Sheet>")
  return (
    <AtlaskitBlanket isTinted onBlanketClicked={() => ctx.onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100vw)",
          background: "var(--color-bg)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </AtlaskitBlanket>
  )
}

function SheetHeader({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16 }}>
      {children}
    </div>
  )
}

function SheetTitle({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <h2 className={className} style={{ fontWeight: 600 }}>
      {children}
    </h2>
  )
}

export { Sheet, SheetContent, SheetHeader, SheetTitle }