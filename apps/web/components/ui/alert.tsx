"use client"

import AtlaskitSectionMessage from "@atlaskit/section-message"
import type { ReactNode, CSSProperties } from "react"

export type AlertVariant = "default" | "destructive"

const VARIANT_TO_APPEARANCE: Record<AlertVariant, "information" | "error"> = {
  default: "information",
  destructive: "error",
}

type AlertProps = {
  variant?: AlertVariant
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

function Alert({ variant = "default", className, style, children }: AlertProps) {
  const message = <AtlaskitSectionMessage appearance={VARIANT_TO_APPEARANCE[variant]}>{children}</AtlaskitSectionMessage>
  if (!className && !style) return message
  return (
    <div className={className} style={style}>
      {message}
    </div>
  )
}

/** SectionMessage has no separate title/description sub-slots the way the
 *  old shadcn Alert did — every current call site only uses
 *  AlertDescription (no AlertTitle usage in the app), so this just passes
 *  children straight through as Alert's own children. */
function AlertDescription({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function AlertTitle({ children }: { children?: ReactNode }) {
  return <strong>{children}</strong>
}

export { Alert, AlertTitle, AlertDescription }