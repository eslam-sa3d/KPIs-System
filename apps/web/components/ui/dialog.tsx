"use client"

import AtlaskitBlanket from "@atlaskit/blanket"
import { createContext, useContext, useEffect, type CSSProperties, type ReactNode } from "react"

/** @atlaskit/modal-dialog renders nothing at runtime in this app — traced
 *  it down to @atlaskit/portal's InternalPortal (a two-render "mount, then
 *  reveal on next render via useEffect" pattern that never completes its
 *  second render here, root cause unconfirmed beyond that point). Rather
 *  than depend on a broken transitive dependency, this composes
 *  @atlaskit/blanket (the same scrim primitive Modal itself uses, confirmed
 *  working) with a plain centered fixed-position box — the same strategy
 *  already proven for Sheet, which has the identical constraint. */

const WIDTH_PX: Record<"small" | "medium" | "large" | "x-large", number> = {
  small: 400,
  medium: 600,
  large: 800,
  "x-large": 968,
}

type DialogContextValue = { onOpenChange: (open: boolean) => void }
const DialogContext = createContext<DialogContextValue | null>(null)

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange: (open: boolean) => void
  children?: ReactNode
}) {
  if (!open) return null
  return <DialogContext.Provider value={{ onOpenChange }}>{children}</DialogContext.Provider>
}

function DialogContent({
  children,
  width = "medium",
  shouldCloseOnEscapePress = true,
}: {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  width?: "small" | "medium" | "large" | "x-large"
  shouldCloseOnEscapePress?: boolean
}) {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error("<DialogContent> must be used inside <Dialog>")

  useEffect(() => {
    if (!shouldCloseOnEscapePress) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") ctx!.onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [shouldCloseOnEscapePress, ctx])

  return (
    <AtlaskitBlanket isTinted onBlanketClicked={() => ctx.onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "60px",
          left: "50%",
          transform: "translateX(-50%)",
          width: `min(${WIDTH_PX[width]}px, calc(100vw - 32px))`,
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
          background: "var(--color-bg)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-modal)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </AtlaskitBlanket>
  )
}

function DialogHeader({ children }: { children?: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>{children}</div>
}

function DialogFooter({ children }: { children?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>{children}</div>
  )
}

function DialogTitle({ children }: { children?: ReactNode; className?: string }) {
  return <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>{children}</h2>
}

function DialogDescription({ children }: { children?: ReactNode }) {
  return <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>{children}</p>
}

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
