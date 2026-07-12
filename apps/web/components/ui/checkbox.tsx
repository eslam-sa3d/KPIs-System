"use client"

import AtlaskitCheckbox, { type CheckboxProps as AtlaskitCheckboxProps } from "@atlaskit/checkbox"

type CheckboxProps = Omit<AtlaskitCheckboxProps, "isChecked" | "onChange" | "isDisabled"> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
}

function Checkbox({ checked, onCheckedChange, disabled, ...props }: CheckboxProps) {
  return (
    <AtlaskitCheckbox
      isChecked={checked}
      isDisabled={disabled}
      onChange={(e) => onCheckedChange?.(e.currentTarget.checked)}
      {...props}
    />
  )
}

export { Checkbox }
export type { CheckboxProps }