"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// This app has its own hand-rolled theme toggle (components/theme-toggle.tsx
// — three-state light/dark/system, data-theme attribute on <html>, no
// next-themes) rather than next-themes, so read that same attribute directly
// instead of pulling in a second, otherwise-unused theming library.
function useDataTheme(): NonNullable<ToasterProps["theme"]> {
  const [theme, setTheme] = useState<NonNullable<ToasterProps["theme"]>>("system")
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.getAttribute("data-theme")
      setTheme(attr === "light" || attr === "dark" ? attr : "system")
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] })
    return () => observer.disconnect()
  }, [])
  return theme
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useDataTheme()

  return (
    <Sonner
      theme={theme}
      icons={{
        success: <CircleCheckIcon size={16} />,
        info: <InfoIcon size={16} />,
        warning: <TriangleAlertIcon size={16} />,
        error: <OctagonXIcon size={16} />,
        loading: <Loader2Icon size={16} style={{ animation: 'spin 1s linear infinite' }} />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
