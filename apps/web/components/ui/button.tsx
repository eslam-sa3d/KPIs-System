"use client"

import AtlaskitButton, {
  IconButton as AtlaskitIconButton,
  LinkButton as AtlaskitLinkButton,
  LinkIconButton as AtlaskitLinkIconButton,
  type ButtonProps as AtlaskitButtonProps,
  type IconButtonProps as AtlaskitIconButtonProps,
  type LinkButtonProps as AtlaskitLinkButtonProps,
  type LinkIconButtonProps as AtlaskitLinkIconButtonProps,
  type Appearance as ButtonAppearance,
  type Spacing as ButtonSpacing,
} from "@atlaskit/button/new"

/** This app's variant vocabulary, mapped onto Atlaskit's `appearance`. There's
 *  no 1:1 match for "outline" or "ghost" (Atlaskit has no bordered-transparent
 *  or fully-transparent button appearance) — both land on "subtle", the
 *  closest low-emphasis appearance Atlaskit ships. */
export type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link"

/** This app's size vocabulary, mapped onto Atlaskit's two-tier `spacing`
 *  ("compact" | "default" — no xs/sm/lg granularity). */
export type ButtonSize = "default" | "xs" | "sm" | "lg"

const VARIANT_TO_APPEARANCE: Record<ButtonVariant, ButtonAppearance> = {
  default: "primary",
  destructive: "danger",
  outline: "default",
  secondary: "default",
  ghost: "subtle",
  link: "default",
}

const SIZE_TO_SPACING: Record<ButtonSize, ButtonSpacing> = {
  default: "default",
  xs: "compact",
  sm: "compact",
  lg: "default",
}

/** Icon-only buttons don't take a `variant`/`size` — Atlaskit's IconButton
 *  appearance vocabulary is deliberately smaller (no primary/danger, since an
 *  icon-only affordance is rarely the primary action) and spacing is just
 *  "default" | "compact". Use this for what used to be
 *  `<Button size="icon"|"icon-xs"|"icon-sm"|"icon-lg">`. */
export type IconButtonSize = "default" | "compact"

type ButtonProps = Omit<AtlaskitButtonProps, "appearance" | "spacing"> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

function Button({ variant = "default", size = "default", ...props }: ButtonProps) {
  return <AtlaskitButton appearance={VARIANT_TO_APPEARANCE[variant]} spacing={SIZE_TO_SPACING[size]} {...props} />
}

type LinkButtonProps = Omit<AtlaskitLinkButtonProps, "appearance" | "spacing"> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

function LinkButton({ variant = "default", size = "default", ...props }: LinkButtonProps) {
  return <AtlaskitLinkButton appearance={VARIANT_TO_APPEARANCE[variant]} spacing={SIZE_TO_SPACING[size]} {...props} />
}

type IconButtonProps = Omit<AtlaskitIconButtonProps, "appearance" | "spacing"> & {
  size?: IconButtonSize
}

function IconButton({ size = "default", ...props }: IconButtonProps) {
  return <AtlaskitIconButton spacing={size} {...props} />
}

type LinkIconButtonProps = Omit<AtlaskitLinkIconButtonProps, "appearance" | "spacing"> & {
  size?: IconButtonSize
}

function LinkIconButton({ size = "default", ...props }: LinkIconButtonProps) {
  return <AtlaskitLinkIconButton spacing={size} {...props} />
}

export { Button, LinkButton, IconButton, LinkIconButton }
export type { ButtonProps, LinkButtonProps, IconButtonProps, LinkIconButtonProps }