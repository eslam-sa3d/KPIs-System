"use client"

import type { ReactElement, ReactNode } from "react"

/** @atlaskit/tooltip also depends on the broken @atlaskit/portal (see
 *  components/ui/dialog.tsx's header comment) — unused anywhere in the app
 *  today (confirmed during the original audit), fixed proactively here so
 *  the same trap doesn't resurface the next time this gets used. Pure CSS
 *  hover/focus (`.pulse-tooltip-trigger:hover + .pulse-tooltip-content`,
 *  see globals.css) needs no portal and no JS state at all for the simple
 *  show-on-hover case this app's call sites would need. */
function TooltipProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function Tooltip({ children }: { children?: ReactNode }) {
  return <span style={{ position: "relative", display: "inline-block" }}>{children}</span>
}

function TooltipTrigger({ children }: { children: ReactElement }) {
  return <span className="pulse-tooltip-trigger">{children}</span>
}

function TooltipContent({ children }: { children?: ReactNode }) {
  return (
    <span role="tooltip" className="pulse-tooltip-content">
      {children}
    </span>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
