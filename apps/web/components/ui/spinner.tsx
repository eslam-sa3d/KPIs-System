"use client"

import AtlaskitSpinner, { type SpinnerProps as AtlaskitSpinnerProps } from "@atlaskit/spinner"

type SpinnerProps = AtlaskitSpinnerProps

/** The app's one loading indicator — pulse purple, used everywhere instead of
 *  skeleton placeholders (which pulled from the tertiary/coral token and read
 *  as off-brand). Atlaskit's Spinner inherits `color: currentColor` rather
 *  than taking an explicit color prop, so the brand color comes from this
 *  wrapping span rather than a Spinner prop. */
function Spinner({ label = "loading", ...props }: SpinnerProps) {
  return (
    <span style={{ color: "var(--md-sys-color-primary)" }}>
      <AtlaskitSpinner label={label} {...props} />
    </span>
  )
}

export { Spinner }
export type { SpinnerProps }