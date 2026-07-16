'use client';

import { api } from '../lib/api-client';
import { ComboboxPicker } from '@/components/ui/combobox-picker';

export interface UserPickerOption {
  id: string;
  email: string;
  displayName: string;
}

/** Searchable "pick a real user" popover, fetched lazily on first open so a
 *  page with several triggers (one per option row) doesn't fetch the roster
 *  until it's actually needed. Trigger renders as plain text, matching the
 *  "add option"/"add Other" links it sits beside. */
export function UserPickerCombobox({
  onSelect,
  disabled,
  triggerLabel = 'Select a user',
}: {
  onSelect: (user: UserPickerOption) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  return (
    <ComboboxPicker<UserPickerOption>
      fetchItems={() => api<UserPickerOption[]>('/v1/users?pageSize=200')}
      getId={(u) => u.id}
      getSearchValue={(u) => `${u.displayName} ${u.email}`}
      renderItem={(u) => (
        <>
          <span className="truncate" style={{ flex: '0 1 auto' }}>
            {u.displayName}
          </span>
          {/* opacity dims relative to whatever the current text color is (default
              foreground, or accent-foreground when this item is keyboard-selected)
              instead of a fixed muted gray, which reads as illegible against the
              selected item's own accent background. */}
          <span className="truncate" style={{ flex: '1 1 auto', fontSize: 12, minWidth: 0, opacity: 0.65 }}>
            {u.email}
          </span>
        </>
      )}
      searchPlaceholder="Search people…"
      triggerLabel={triggerLabel}
      triggerVariant="ghost"
      triggerClassName="option-row-other-link"
      disabled={disabled}
      onSelect={onSelect}
    />
  );
}
