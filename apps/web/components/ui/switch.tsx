"use client"

import AtlaskitToggle from "@atlaskit/toggle"
import type { ChangeEvent } from "react"

type SwitchProps = {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  size?: "sm" | "default"
  isDisabled?: boolean
  id?: string
  name?: string
}

const SIZE_TO_ATLASKIT: Record<"sm" | "default", "regular" | "large"> = {
  sm: "regular",
  default: "large",
}

function Switch({ checked, onCheckedChange, size = "default", ...props }: SwitchProps) {
  return (
    <AtlaskitToggle
      isChecked={checked}
      size={SIZE_TO_ATLASKIT[size]}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onCheckedChange?.(e.currentTarget.checked)}
      {...props}
    />
  )
}

export { Switch }
export type { SwitchProps }