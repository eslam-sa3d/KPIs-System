'use client';

import { useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

/**
 * Shared entrance animation for card/row-based pages (dashboard, forms,
 * roles, team members): fades + rises every element matching `selector`
 * inside the returned scope, once `ready` flips true. Runs once per
 * `ready` transition (loading → loaded), not on every re-render, and is a
 * no-op under prefers-reduced-motion — same accessibility rule the
 * landing page's hero-float keyframe already follows (see globals.css).
 */
export function useReveal<T extends HTMLElement>(selector: string, ready: boolean): RefObject<T | null> {
  const scope = useRef<T>(null);

  useGSAP(
    () => {
      if (!ready) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const targets = gsap.utils.toArray<HTMLElement>(selector);
      if (targets.length === 0) return;
      const tween = gsap.from(targets, {
        opacity: 0,
        y: 12,
        duration: 0.4,
        stagger: 0.04,
        ease: 'power2.out',
      });
      // Belt-and-suspenders: a hard remount (dev Fast Refresh, a fast
      // double-navigation, React StrictMode's double-invoke landing at an
      // unlucky moment) can kill this tween mid-flight without GSAP
      // cleanly reverting the inline opacity/transform it already applied
      // — elements are then stuck invisible forever instead of settling at
      // their natural, fully-visible state. Force the end state once the
      // longest possible run (last stagger delay + its own duration) has
      // elapsed, regardless of what happened to the tween itself.
      const settle = gsap.delayedCall(0.4 + targets.length * 0.04, () =>
        gsap.set(targets, { clearProps: 'opacity,transform' }),
      );
      return () => {
        tween.kill();
        settle.kill();
        gsap.set(targets, { clearProps: 'opacity,transform' });
      };
    },
    { scope, dependencies: [ready] },
  );

  return scope;
}
