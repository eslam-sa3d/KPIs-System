"use client"

import { Label as AtlaskitLabel } from "@atlaskit/form"
import type { ReactNode } from "react"

type LabelProps = {
  htmlFor?: string
  children: ReactNode
  className?: string
}

/** @atlaskit/form's Label requires `htmlFor` (it's a real form-control
 *  label, not just styled caption text) — every current call site uses this
 *  purely as a section caption with no associated control id, so those fall
 *  back to a plain span with the same styling rather than forcing a
 *  semantically-wrong htmlFor onto an unrelated element. */
function Label({ htmlFor, className, children }: LabelProps) {
  if (htmlFor) return <AtlaskitLabel htmlFor={htmlFor}>{children}</AtlaskitLabel>
  return <span className={className}>{children}</span>
}

export { Label }
export type { LabelProps }