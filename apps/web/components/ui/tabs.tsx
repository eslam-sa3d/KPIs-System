"use client"

import AtlaskitTabs, { TabList, Tab } from "@atlaskit/tabs"
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"

type TabsContextValue = { value: string; onValueChange: (value: string) => void }
const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`)
  return ctx
}

/** Atlaskit's Tabs is index-based (`selected: number`), not value-based like
 *  the app's existing `value`/`onValueChange` call sites — this wrapper
 *  keeps the value-based API by deriving an index from the ordered list of
 *  `<TabsTrigger value>` children found inside `<TabsList>`, matching
 *  React's own conditional-child-filtering (`{cond && <TabsTrigger .../>}`)
 *  via `Children.forEach`, which the caller already relies on being
 *  consistent between its TabsList and TabsContent conditionals. */
function collectTriggerValues(children: ReactNode): string[] {
  const values: string[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string; children?: ReactNode }
    if (child.type === TabsList) {
      values.push(...collectTriggerValues(props.children))
    } else if (typeof props.value === "string") {
      values.push(props.value)
    }
  })
  return values
}

type TabsProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
} & (
  | { value: string; onValueChange: (value: string) => void; defaultValue?: undefined }
  | { value?: undefined; onValueChange?: undefined; defaultValue: string }
)

function Tabs({ className, style, children, ...controlProps }: TabsProps) {
  const id = useId()
  const [uncontrolledValue, setUncontrolledValue] = useState(
    controlProps.defaultValue ?? controlProps.value ?? "",
  )
  const value = controlProps.value ?? uncontrolledValue
  const onValueChange = controlProps.onValueChange ?? setUncontrolledValue

  const orderedValues = collectTriggerValues(children)
  const selected = Math.max(0, orderedValues.indexOf(value))

  const tabs = (
    <AtlaskitTabs
      id={id}
      selected={selected}
      onChange={(index) => {
        const next = orderedValues[index]
        if (next !== undefined) onValueChange(next)
      }}
    >
      {children}
    </AtlaskitTabs>
  )

  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      {className || style ? (
        <div className={className} style={style}>
          {tabs}
        </div>
      ) : (
        tabs
      )}
    </TabsContext.Provider>
  )
}

function TabsList({ children }: { variant?: "default" | "line"; "aria-label"?: string; children: ReactNode }) {
  return <TabList>{children}</TabList>
}

/** Tab has no selection prop of its own — Atlaskit derives it from the tab's
 *  position among TabList's rendered children matching Tabs' `selected`
 *  index, which lines up with `value` here because both this component and
 *  the `selected` index above are derived from the same ordered child list.
 *  Tab also has no className — a per-trigger color override at one call
 *  site is dropped in favor of Atlaskit's own active-tab styling. */
function TabsTrigger({ children }: { value: string; className?: string; children: ReactNode }) {
  return <Tab>{children}</Tab>
}

/** Deliberately not Atlaskit's TabPanel (which is positionally matched to
 *  Tab index, not value) — plain conditional rendering keyed off the same
 *  value/context the trigger uses, avoiding any positional-mismatch risk. */
function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useTabsContext("TabsContent")
  if (ctx.value !== value) return null
  return (
    <div role="tabpanel" style={{ flex: 1 }}>
      {children}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }