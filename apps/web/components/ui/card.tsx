"use client"

import Box from "@atlaskit/primitives/box"
import type { ReactNode, CSSProperties } from "react"

type DivProps = {
  children?: ReactNode
  style?: CSSProperties
  id?: string
  /** Box doesn't accept className (styling goes through `style`/xcss) — kept
   *  here only for legacy CSS hooks (descendant selectors in globals.css)
   *  that some callers still rely on, applied via a wrapping span. */
  className?: string
}

function withClassName(className: string | undefined, box: ReactNode) {
  return className ? <div className={className}>{box}</div> : box
}

function Card({ style, className, ...props }: DivProps) {
  return withClassName(
    className,
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
        ...style,
      }}
      backgroundColor="elevation.surface"
      padding="space.300"
      {...props}
    />,
  )
}

function CardHeader({ style, className, ...props }: DivProps) {
  return withClassName(
    className,
    <Box style={{ display: "grid", gap: 8, paddingInline: 24, ...style }} {...props} />,
  )
}

function CardTitle({ style, className, ...props }: DivProps) {
  return withClassName(className, <Box style={{ lineHeight: 1, fontWeight: 600, ...style }} {...props} />)
}

function CardDescription({ style, className, ...props }: DivProps) {
  return withClassName(
    className,
    <Box style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", ...style }} {...props} />,
  )
}

function CardAction({ style, className, ...props }: DivProps) {
  return withClassName(className, <Box style={{ justifySelf: "end", ...style }} {...props} />)
}

function CardContent({ style, className, ...props }: DivProps) {
  return withClassName(className, <Box style={{ paddingInline: 24, ...style }} {...props} />)
}

function CardFooter({ style, className, ...props }: DivProps) {
  return withClassName(
    className,
    <Box style={{ display: "flex", alignItems: "center", paddingInline: 24, ...style }} {...props} />,
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }