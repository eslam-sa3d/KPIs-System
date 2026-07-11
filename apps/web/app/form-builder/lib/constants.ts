import { AlignLeft, Calendar, CheckSquare, ChevronDown, Circle, Clock, Grid3x3, SlidersHorizontal, Table2, Type, Upload } from 'lucide-react';
import type { FieldType } from './types';

/** Google Forms' own editor chrome color — fixed here regardless of a
 *  form's own (user-customizable) theme.primaryColor, the same way Forms'
 *  toolbar stays its own purple no matter what color a form's respondents
 *  see. */
export const GOOGLE_PURPLE = '#673ab7';
export const GOOGLE_PURPLE_DARK = '#5b2eaa';
export const CANVAS_WASH = '#f0ebf8';

export const FIELD_TYPE_ICONS: Record<FieldType, typeof Type> = {
  short_answer: Type,
  paragraph: AlignLeft,
  multiple_choice: Circle,
  checkboxes: CheckSquare,
  dropdown: ChevronDown,
  file_upload: Upload,
  linear_scale: SlidersHorizontal,
  multiple_choice_grid: Grid3x3,
  checkbox_grid: Table2,
  date: Calendar,
  time: Clock,
};
