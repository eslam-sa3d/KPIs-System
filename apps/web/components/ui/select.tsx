"use client"

import AtlaskitSelect from "@atlaskit/select"
import { Children, isValidElement, useId, type ReactNode } from "react"

/** Atlaskit's Select is react-select-based — one component driven by an
 *  `options` array + `value`/`onChange`, not composed `<SelectItem>`
 *  children like Radix's Select. This wrapper walks the composed children
 *  (same traversal technique as Tabs/RadioGroup/DropdownMenu) to build that
 *  options array, so call sites didn't need to change shape.
 *
 *  Uncontrolled usage (`<Select name="x">` with no value/onValueChange, for
 *  native FormData submission — see admin/kpis/page.tsx's AssignToField)
 *  still works: passing `name` through to react-select with no `value` lets
 *  it self-manage selection and emit its own hidden `<input name>` in sync,
 *  the same native-form-participation behavior the old Radix Select
 *  documented at that call site. */

type Option = { value: string; label: ReactNode }

function collectOptions(children: ReactNode): Option[] {
  const options: Option[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string; children?: ReactNode }
    if (child.type === SelectContent) {
      options.push(...collectOptions(props.children))
    } else if (child.type === SelectItem && typeof props.value === "string") {
      options.push({ value: props.value, label: props.children })
    }
  })
  return options
}

/** Extracts SelectTrigger's `id`/`aria-label` and SelectValue's
 *  `placeholder` — the trigger itself isn't rendered (Atlaskit's Select
 *  renders its own control), but its id/label still need to reach the real
 *  focusable element for <label htmlFor> associations to keep working. */
function findTriggerMeta(children: ReactNode): { id?: string; ariaLabel?: string; placeholder?: string } {
  let meta: { id?: string; ariaLabel?: string; placeholder?: string } = {}
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { children?: ReactNode; placeholder?: string; id?: string; "aria-label"?: string }
    if (child.type === SelectTrigger) {
      meta = { ...findTriggerMeta(props.children), id: props.id, ariaLabel: props["aria-label"] }
    } else if (child.type === SelectValue && typeof props.placeholder === "string") {
      meta.placeholder = props.placeholder
    }
  })
  return meta
}

type SelectProps = {
  value?: string
  onValueChange?: (value: string) => void
  name?: string
  disabled?: boolean
  children?: ReactNode
}

function Select({ value, onValueChange, name, disabled, children }: SelectProps) {
  // react-select generates internal element ids from an auto-incrementing
  // counter unless given a stable instanceId — without one, server and
  // client render passes can land on different counter values (order of
  // Select instances mounted differs), producing a hydration mismatch.
  // useId() is React's own SSR-safe stable-id primitive.
  const instanceId = useId()
  const options = collectOptions(children)
  const { id, ariaLabel, placeholder } = findTriggerMeta(children)
  const selected = value !== undefined ? options.find((o) => o.value === value) ?? null : undefined

  return (
    <AtlaskitSelect
      instanceId={instanceId}
      inputId={id}
      aria-label={ariaLabel}
      name={name}
      options={options}
      value={selected}
      placeholder={placeholder}
      isDisabled={disabled}
      formatOptionLabel={(option: Option) => option.label}
      getOptionValue={(option: Option) => option.value}
      onChange={(option: Option | null) => {
        if (option) onValueChange?.(option.value)
      }}
    />
  )
}

/** Markers consumed by Select's traversal above — not rendered directly. */
function SelectTrigger({
  children,
}: {
  children?: ReactNode
  className?: string
  size?: "sm" | "default"
  id?: string
  "aria-label"?: string
}) {
  return <>{children}</>
}

function SelectValue(_props: { placeholder?: string; children?: ReactNode }) {
  return null
}

function SelectContent({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function SelectItem({ children }: { value: string; children?: ReactNode }) {
  return <>{children}</>
}

function SelectGroup({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function SelectLabel({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function SelectSeparator() {
  return null
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
}