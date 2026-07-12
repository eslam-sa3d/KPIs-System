"use client"

import AtlaskitLozenge from "@atlaskit/lozenge"
import type { CSSProperties, ReactNode } from "react"

/** This app's variant vocabulary, mapped onto Lozenge's fixed appearance set
 *  (default/inprogress/moved/new/removed/success — no brand-purple option),
 *  plus a `style` override for the brand-colored "default" variant. Lozenge
 *  has no onClick/polymorphism — for a clickable pill, wrap this in a real
 *  `<button>` (see admin/kpis/page.tsx's StatusPill for the pattern). */
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost"

const VARIANT_STYLE: Record<BadgeVariant, { backgroundColor: string; color: string } | undefined> = {
  default: { backgroundColor: "var(--md-sys-color-primary)", color: "var(--md-sys-color-on-primary)" },
  secondary: { backgroundColor: "var(--md-sys-color-secondary-container)", color: "var(--md-sys-color-on-secondary-container)" },
  destructive: undefined,
  outline: { backgroundColor: "transparent", color: "var(--color-text)" },
  ghost: { backgroundColor: "transparent", color: "var(--color-text)" },
}

type BadgeProps = {
  variant?: BadgeVariant
  children?: ReactNode
  testId?: string
  /** Only `backgroundColor`/`color` are honored — Lozenge's own constraint. */
  style?: Pick<CSSProperties, "backgroundColor" | "color">
}

function Badge({ variant = "default", style, ...props }: BadgeProps) {
  const appearance = variant === "destructive" ? "removed" : "default"
  return <AtlaskitLozenge appearance={appearance} style={style ?? VARIANT_STYLE[variant]} {...props} />
}

export { Badge }
export type { BadgeProps }