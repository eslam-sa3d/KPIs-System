"use client"

import AtlaskitTextArea, { type TextAreaProps } from "@atlaskit/textarea"

type TextareaProps = Omit<TextAreaProps, "isDisabled"> & {
  disabled?: boolean
}

function Textarea({ disabled, ...props }: TextareaProps) {
  return <AtlaskitTextArea isDisabled={disabled} {...props} />
}

export { Textarea }
export type { TextareaProps }
