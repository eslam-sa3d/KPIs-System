import type { KpiComboboxOption } from '@/components/kpi-link-combobox';

/** A local stand-in for a GET /v1/kpis response — this module has no live
 *  API, so the "link to KPI" picker (question ⋮ menu) reads from here. */
export const MOCK_KPIS: KpiComboboxOption[] = [
  {
    id: 'kpi_support_quality',
    name: 'Support Quality',
    evaluationAreas: [
      { id: 'area_speed', name: 'Response speed', isActive: true },
      { id: 'area_accuracy', name: 'Resolution accuracy', isActive: true },
      { id: 'area_tone', name: 'Communication tone', isActive: true },
    ],
  },
  {
    id: 'kpi_customer_satisfaction',
    name: 'Customer Satisfaction',
    evaluationAreas: [
      { id: 'area_csat', name: 'Overall CSAT', isActive: true },
      { id: 'area_nps', name: 'Likelihood to recommend', isActive: true },
    ],
  },
  {
    id: 'kpi_agent_performance',
    name: 'Agent Performance',
    evaluationAreas: [
      { id: 'area_handle_time', name: 'Average handle time', isActive: true },
      { id: 'area_first_contact', name: 'First-contact resolution', isActive: true },
      { id: 'area_retired', name: 'Legacy scorecard (retired)', isActive: false },
    ],
  },
];
