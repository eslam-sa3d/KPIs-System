import * as React from 'react';

import { cn } from '@/lib/utils';

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as React.RefObject<T | null>).current = node;
    }
  };
}

/** Narrow replacement for Radix's `Slot`/`asChild` — clones the single child
 *  element, merging props with the child rather than wrapping it in an extra
 *  DOM node. Every real usage in this app is one of: Button → `<Link>`,
 *  Badge → `<button>`, or a Trigger wrapping a plain `<button>` — never deep
 *  polymorphic composition — so a full `Slot` clone isn't needed.
 *
 *  Merge rule: `className`/`style` combine, event handlers present on both
 *  sides compose (wrapper's fires first), refs merge, and everything else
 *  from the child wins over the wrapper (e.g. the child's own `href`) except
 *  where the child left a prop undefined. */
export function renderAsChild(
  child: React.ReactElement,
  props: React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> },
) {
  const childProps = child.props as Record<string, unknown>;
  const { ref: propsRef, className: propsClassName, style: propsStyle, ...restProps } = props;
  const childRef = (child as unknown as { ref?: React.Ref<HTMLElement> }).ref;

  const merged: Record<string, unknown> = { ...restProps };
  for (const key of Object.keys(childProps)) {
    const childValue = childProps[key];
    const wrapperValue = merged[key];
    if (key.startsWith('on') && typeof childValue === 'function' && typeof wrapperValue === 'function') {
      merged[key] = (...args: unknown[]) => {
        (wrapperValue as (...a: unknown[]) => void)(...args);
        (childValue as (...a: unknown[]) => void)(...args);
      };
    } else if (childValue !== undefined) {
      merged[key] = childValue;
    }
  }

  return React.cloneElement(child, {
    ...merged,
    className: cn(propsClassName, childProps.className as string | undefined),
    style: { ...(propsStyle as object), ...(childProps.style as object) },
    ref: mergeRefs(propsRef, childRef),
  } as Partial<unknown>);
}
