"use client"

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"

/** @atlaskit/dropdown-menu's popup content depends on the same
 *  @atlaskit/portal machinery that silently fails to render in this app
 *  (see components/ui/dialog.tsx's header comment for the full trace) — the
 *  "..." kebab menu never opened. Same fix strategy: a plain, self-contained
 *  positioned menu instead of a portaled one. Anchored via a relatively-
 *  positioned wrapper rather than a portal, so it scrolls with its trigger
 *  (fine for this app's menus, all inside scrollable cards, not viewport-
 *  fixed toolbars). */

type MenuContextValue = { open: boolean; setOpen: (open: boolean) => void }
const MenuContext = createContext<MenuContextValue | null>(null)

function useMenuContext(component: string): MenuContextValue {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <DropdownMenu>`)
  return ctx
}

function DropdownMenu({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <MenuContext.Provider value={{ open, setOpen }}>
      <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
        {children}
      </div>
    </MenuContext.Provider>
  )
}

function DropdownMenuTrigger({ children }: { children: ReactElement; asChild?: boolean }) {
  const ctx = useMenuContext("DropdownMenuTrigger")
  if (!isValidElement(children)) return children
  const child = children as ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
  return cloneElement(child, {
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e)
      ctx.setOpen(!ctx.open)
    },
  })
}

function DropdownMenuContent({ children, align = "start" }: { children?: ReactNode; align?: "start" | "end" }) {
  const ctx = useMenuContext("DropdownMenuContent")
  if (!ctx.open) return null
  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        [align === "end" ? "right" : "left"]: 0,
        zIndex: 50,
        minWidth: 180,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
        boxShadow: "var(--shadow-modal)",
        padding: 4,
      }}
    >
      {children}
    </div>
  )
}

function DropdownMenuItem({
  children,
  variant,
  onSelect,
}: {
  children?: ReactNode
  variant?: "default" | "destructive"
  onSelect?: () => void
}) {
  const ctx = useMenuContext("DropdownMenuItem")
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onSelect?.()
        ctx.setOpen(false)
      }}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 8px",
        borderRadius: "var(--radius-sm)",
        fontSize: "0.875rem",
        color: variant === "destructive" ? "var(--md-sys-color-error)" : "var(--color-text)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  )
}

function DropdownMenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  children?: ReactNode
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        borderRadius: "var(--radius-sm)",
        fontSize: "0.875rem",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked ?? false}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
      {children}
    </label>
  )
}

function DropdownMenuGroup({ children }: { children?: ReactNode }) {
  return <div role="group">{children}</div>
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
}
