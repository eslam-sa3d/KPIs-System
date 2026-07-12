"use client"

import AtlaskitTextfield, { type TextFieldProps } from "@atlaskit/textfield"
import type { ChangeEvent } from "react"

type InputProps = Omit<TextFieldProps, "isDisabled" | "onChange"> & {
  disabled?: boolean
  /** Atlaskit types this as a generic FormEventHandler, whose `.target` isn't
   *  narrowed to HTMLInputElement — re-typed here as the standard
   *  ChangeEventHandler so every `e.target.value` call site keeps working. */
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
}

function Input({ disabled, ...props }: InputProps) {
  return <AtlaskitTextfield isDisabled={disabled} {...props} />
}

export { Input }
export type { InputProps }