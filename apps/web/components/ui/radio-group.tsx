"use client"

import { Radio as AtlaskitRadio } from "@atlaskit/radio"
import { createContext, useContext, useId, type ReactNode } from "react"

type RadioGroupContextValue = { value?: string; onValueChange?: (value: string) => void; name: string }
const RadioGroupContext = createContext<RadioGroupContextValue | null>(null)

/** Atlaskit's own RadioGroup takes an `options` array, not composed
 *  `<RadioGroupItem>` children — this app's call sites build each item's
 *  content individually (icon/label composition, not just plain text), so
 *  this wrapper uses individual `Radio` elements sharing a `name` instead,
 *  same shape as the Tabs value-bridge context. */
function RadioGroup({
  value,
  onValueChange,
  children,
}: {
  value?: string
  onValueChange?: (value: string) => void
  children?: ReactNode
}) {
  const name = useId()
  return (
    <RadioGroupContext.Provider value={{ value, onValueChange, name }}>
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </RadioGroupContext.Provider>
  )
}

function RadioGroupItem({ value }: { value: string; id?: string }) {
  const ctx = useContext(RadioGroupContext)
  if (!ctx) throw new Error("<RadioGroupItem> must be used inside <RadioGroup>")
  return (
    <AtlaskitRadio
      name={ctx.name}
      value={value}
      isChecked={ctx.value === value}
      onChange={() => ctx.onValueChange?.(value)}
    />
  )
}

export { RadioGroup, RadioGroupItem }