# Patches

pnpm applies these automatically on install via `pnpm.patchedDependencies` in
the root `package.json`. If a patched dependency gets bumped, pnpm will flag
the patch as unused/stale on install — re-run `pnpm patch` against the new
version and confirm the fix is still needed before dropping it.

## `@material__material-color-utilities@0.4.0.patch`

Used by `packages/theme` to derive the Material Design 3 token palette from
the pulse brand colors. Version 0.4.0's own internal ES module imports omit
the `.js` extension on relative specifiers (e.g. `from './dynamic_color'`
instead of `'./dynamic_color.js'`), which Node's native ESM resolver rejects
outright — bundler-style extensionless resolution isn't standard ESM. This
patch adds the missing extensions across the affected files.

Check the upstream package's source on any version bump: if a later release
fixes this itself, the patch (and this entry) can be deleted.
