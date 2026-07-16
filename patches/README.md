# Patches

pnpm applies these automatically on install via `pnpm.patchedDependencies` in
the root `package.json`. If a patched dependency gets bumped, pnpm will flag
the patch as unused/stale on install — re-run `pnpm patch` against the new
version and confirm the fix is still needed before dropping it.

No patches are currently in use.
