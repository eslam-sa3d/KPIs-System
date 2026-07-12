"use client"

import AtlaskitTable, { Cell, Row, THead, TBody, HeadCell } from "@atlaskit/table"
import { createContext, useContext, type ReactElement, type ReactNode, type CSSProperties } from "react"

/** Atlaskit's Row calls useTableBody() internally and throws outside a
 *  TBody — it's body-rows-only. A header "row" is just HeadCells placed
 *  directly inside THead, no Row wrapper. This context lets TableRow tell
 *  the two cases apart without every header call site changing shape. */
const InTableHeaderContext = createContext(false)

type SortDirection = "ascending" | "descending" | "none" | "other"

type CommonProps = {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  colSpan?: number
}

/** Atlaskit's Cell/HeadCell don't accept className/style (only `xcss`, which
 *  needs the Compiled babel plugin this app doesn't run) — className/style
 *  land on an inner wrapper div instead. Visually equivalent for the
 *  color/cursor rules these classes carry; a `.p-th-sortable` header's own
 *  padding reset only reaches the inner div, not the `<th>` itself. */
function CellContent({ className, style, children }: Pick<CommonProps, "className" | "style" | "children">) {
  if (!className && !style) return <>{children}</>
  return (
    <div className={className} style={style}>
      {children}
    </div>
  )
}

function Table({ className, style, children }: CommonProps & { children: ReactElement[] | ReactElement }) {
  return (
    <div
      className={className ? `ak-table-scroll ${className}` : "ak-table-scroll"}
      style={style}
    >
      <AtlaskitTable>{children}</AtlaskitTable>
    </div>
  )
}

function TableHeader({ children }: CommonProps) {
  return (
    <InTableHeaderContext.Provider value={true}>
      <THead>{children}</THead>
    </InTableHeaderContext.Provider>
  )
}

function TableBody({ children }: CommonProps & { children: ReactElement[] | ReactElement }) {
  return <TBody>{children}</TBody>
}

/** Row has no className/style of its own — a row-level hover/focus-reveal
 *  class (`.hover-actions-row`) can't be replicated without it, so that
 *  effect is dropped where used; the revealed content just stays visible. */
function TableRow({ children }: CommonProps) {
  const inHeader = useContext(InTableHeaderContext)
  if (inHeader) return <>{children}</>
  return <Row>{children}</Row>
}

/** HeadCell's public type doesn't expose sortDirection (only used
 *  internally by Atlaskit's own SortableColumn) — `aria-sort` is accepted
 *  here for call-site compatibility but not forwarded; screen readers lose
 *  the sort-direction announcement on these headers. */
function TableHead({
  className,
  style,
  colSpan,
  children,
}: CommonProps & { "aria-sort"?: SortDirection }) {
  return (
    <HeadCell colSpan={colSpan}>
      <CellContent className={className} style={style}>
        {children}
      </CellContent>
    </HeadCell>
  )
}

function TableCell({ className, style, colSpan, children }: CommonProps) {
  return (
    <Cell colSpan={colSpan}>
      <CellContent className={className} style={style}>
        {children}
      </CellContent>
    </Cell>
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }