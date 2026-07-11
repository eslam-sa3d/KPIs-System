import type { FormDefinition, FormField, Submission } from './types';

/**
 * A hand-authored sample form + submissions, used only to demo the Responses
 * tab's charts and the paginated submission viewer. Ids are fixed strings
 * (not lib/field-defaults's generator) so the submissions below can key
 * answers to them legibly.
 */

const FIELDS: FormField[] = [
  {
    id: 'f_name',
    type: 'short_answer',
    title: "What's your name?",
    description: '',
    required: false,
    validation: { kind: 'none' },
  },
  {
    id: 'f_contact_method',
    type: 'multiple_choice',
    title: 'How did you contact support?',
    description: '',
    required: true,
    options: [
      { id: 'o_email', value: 'Email' },
      { id: 'o_phone', value: 'Phone' },
      { id: 'o_chat', value: 'Live chat' },
      { id: 'o_person', value: 'In person' },
    ],
    allowOther: false,
    shuffleOptions: false,
    // "Live chat" skips the phone follow-up page entirely; everything else falls through
    branching: { o_chat: 'sec_wrapup' },
  },
  {
    id: 'f_satisfaction',
    type: 'linear_scale',
    title: 'How satisfied were you overall?',
    description: '',
    required: true,
    min: 1,
    max: 5,
    minLabel: 'Very unsatisfied',
    maxLabel: 'Very satisfied',
  },
  {
    id: 'f_liked',
    type: 'checkboxes',
    title: 'What did you like about the support?',
    description: 'Select all that apply.',
    required: false,
    options: [
      { id: 'o_speed', value: 'Speed' },
      { id: 'o_friendly', value: 'Friendliness' },
      { id: 'o_knowledge', value: 'Knowledge' },
      { id: 'o_followup', value: 'Follow-up' },
    ],
    allowOther: true,
    shuffleOptions: false,
  },
  {
    id: 'f_aspects_grid',
    type: 'multiple_choice_grid',
    title: 'Rate these aspects of your support experience',
    description: '',
    required: false,
    rows: ['Speed', 'Clarity', 'Friendliness'],
    columns: ['Poor', 'Fair', 'Good', 'Excellent'],
    requireOneResponsePerRow: false,
  },
  {
    id: 'f_phone_team',
    type: 'dropdown',
    title: 'Which team did you speak with?',
    description: '',
    required: true,
    options: [
      { id: 'o_billing', value: 'Billing' },
      { id: 'o_technical', value: 'Technical' },
      { id: 'o_sales', value: 'Sales' },
      { id: 'o_general', value: 'General' },
    ],
    shuffleOptions: false,
    branching: {},
  },
  {
    id: 'f_phone_date',
    type: 'date',
    title: 'When did you call?',
    description: '',
    required: false,
    includeYear: true,
    includeTime: false,
  },
  {
    id: 'f_phone_time',
    type: 'time',
    title: 'Around what time?',
    description: '',
    required: false,
    isDuration: false,
  },
  {
    id: 'f_comments',
    type: 'paragraph',
    title: 'Any additional comments?',
    description: '',
    required: false,
    validation: { kind: 'length', maxLength: 1000 },
  },
  {
    id: 'f_return_grid',
    type: 'checkbox_grid',
    title: 'Which channels would you use again?',
    description: '',
    required: false,
    rows: ['Email', 'Phone', 'Live chat'],
    columns: ['Yes', 'No', 'Maybe'],
    requireOneResponsePerRow: false,
  },
  {
    id: 'f_screenshot',
    type: 'file_upload',
    title: 'Attach a screenshot if relevant (optional)',
    description: '',
    required: false,
    allowedTypes: ['image'],
    maxFiles: 1,
    maxSizeMb: 10,
  },
];

const fieldsById = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

export const MOCK_FORM: FormDefinition = {
  id: 'form_support_feedback',
  title: 'Customer Support Feedback',
  description: 'Tell us about your most recent support experience — it takes about 2 minutes.',
  theme: {
    headerImageUrl: null,
    primaryColor: '#4f008c',
    backgroundColor: '#f5f3f7',
    fontStyle: 'default',
  },
  fields: fieldsById,
  sections: [
    {
      id: 'sec_about',
      title: 'About your experience',
      description: '',
      fieldIds: ['f_name', 'f_contact_method', 'f_satisfaction', 'f_liked', 'f_aspects_grid'],
    },
    {
      id: 'sec_phone',
      title: 'Phone support follow-up',
      description: 'A couple of quick questions since you called in.',
      fieldIds: ['f_phone_team', 'f_phone_date', 'f_phone_time'],
    },
    {
      id: 'sec_wrapup',
      title: 'Wrap-up',
      description: '',
      fieldIds: ['f_comments', 'f_return_grid', 'f_screenshot'],
    },
  ],
};

const names = ['Alex', 'Jordan', 'Sam', 'Riya', 'Marco', 'Chen', 'Priya', 'Owen', 'Fatima', 'Liam', 'Nadia', 'Theo'];
const contactMethods = ['Email', 'Phone', 'Live chat', 'In person'];
const likedPool = ['Speed', 'Friendliness', 'Knowledge', 'Follow-up'];
const comments = [
  'Really quick turnaround, thanks!',
  'Had to explain my issue twice, a bit frustrating.',
  '',
  'The agent was very knowledgeable and patient.',
  'Would like faster live chat response times.',
  '',
  'Everything was resolved in one call.',
  'Great experience overall.',
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

export const MOCK_SUBMISSIONS: Submission[] = Array.from({ length: 14 }, (_, i) => {
  const contact = pick(contactMethods, i);
  const satisfaction = String(1 + ((i * 2 + (contact === 'Phone' ? 1 : 0)) % 5));
  const liked = [likedPool[i % 4]!, likedPool[(i + 1) % 4]!].filter((_, idx) => idx === 0 || i % 2 === 0);
  const answers: Submission['answers'] = {
    f_name: i % 5 === 0 ? '' : pick(names, i),
    f_contact_method: contact,
    f_satisfaction: satisfaction,
    f_liked: i % 6 === 0 ? [...liked, 'other:translation support'] : liked,
    f_aspects_grid: {
      Speed: pick(['Poor', 'Fair', 'Good', 'Excellent'], i),
      Clarity: pick(['Fair', 'Good', 'Good', 'Excellent'], i + 1),
      Friendliness: pick(['Good', 'Excellent', 'Excellent', 'Good'], i + 2),
    },
    f_comments: pick(comments, i),
    f_return_grid: {
      Email: [pick(['Yes', 'No', 'Maybe'], i)],
      Phone: [pick(['Yes', 'Maybe', 'No'], i + 1)],
      'Live chat': [pick(['Yes', 'Yes', 'Maybe'], i + 2)],
    },
  };
  if (contact === 'Phone') {
    answers.f_phone_team = pick(['Billing', 'Technical', 'Sales', 'General'], i);
    answers.f_phone_date = `2026-0${1 + (i % 6)}-${10 + (i % 15)}`;
    answers.f_phone_time = `${9 + (i % 8)}:${i % 2 === 0 ? '00' : '30'}`;
  }
  return {
    id: `sub_${i + 1}`,
    submittedAt: new Date(2026, 5, 1 + i, 9 + (i % 8), (i * 7) % 60).toISOString(),
    answers,
  };
});
