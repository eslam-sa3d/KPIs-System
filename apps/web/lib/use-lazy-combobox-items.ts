'use client';

import { useState } from 'react';

/** Fetches a combobox's option list on first open rather than on mount, so a
 *  page with several triggers (one per option row) doesn't fetch until a
 *  given one is actually opened. */
export function useLazyComboboxItems<T>(fetchItems: () => Promise<T[]>) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[] | null>(null);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && items === null) {
      fetchItems()
        .then(setItems)
        .catch(() => setItems([]));
    }
  };

  return { open, onOpenChange, items };
}
