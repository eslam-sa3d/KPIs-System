/** Dummy cards for the Forms home screen (/form-builder) — a Google-Forms-style
 *  "recent forms" grid. Purely cosmetic; every card opens the same mock
 *  editor at /form-builder/edit since this prototype has no per-form storage. */
export interface MockFormListItem {
  id: string;
  title: string;
  editedLabel: string;
  responseCount: number;
  color: string;
}

export const MOCK_FORMS_LIST: MockFormListItem[] = [
  { id: 'form_support_feedback', title: 'Customer Support Feedback', editedLabel: 'Edited 2 hours ago', responseCount: 14, color: '#673ab7' },
  { id: 'form_onboarding', title: 'New Hire Onboarding Survey', editedLabel: 'Edited yesterday', responseCount: 8, color: '#1a73e8' },
  { id: 'form_event_rsvp', title: 'Team Offsite RSVP', editedLabel: 'Edited 3 days ago', responseCount: 22, color: '#188038' },
  { id: 'form_exit_interview', title: 'Exit Interview', editedLabel: 'Edited last week', responseCount: 3, color: '#d93025' },
  { id: 'form_product_feedback', title: 'Product Feedback Round 2', editedLabel: 'Edited 2 weeks ago', responseCount: 0, color: '#e37400' },
  { id: 'form_it_request', title: 'IT Equipment Request', editedLabel: 'Edited last month', responseCount: 11, color: '#12805c' },
];
