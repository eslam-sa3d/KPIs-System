import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The app's one loading indicator — an animated ring in the pulse purple,
 *  used everywhere instead of skeleton placeholders (which pulled from the
 *  tertiary/coral token and read as off-brand). */
function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2 data-slot="spinner" className={cn('animate-spin text-primary', className)} aria-hidden="true" {...props} />
  );
}

export { Spinner };
