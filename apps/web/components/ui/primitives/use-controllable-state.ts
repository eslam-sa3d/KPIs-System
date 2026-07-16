import * as React from 'react';

/** Standard controlled/uncontrolled value pattern — pass `value` to control it
 *  externally, or omit it (optionally with `defaultValue`) to let this hook
 *  own the state internally. Either way `onChange` fires on every update. */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
}) {
  const [internal, setInternal] = React.useState<T>(defaultValue as T);
  const isControlled = value !== undefined;
  const current = isControlled ? (value as T) : internal;

  const setValue = React.useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  return [current, setValue] as const;
}
