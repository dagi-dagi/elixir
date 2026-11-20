"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Page heading that receives focus when the screen appears, so screen-reader
 * and keyboard users land on the new content after each kiosk transition.
 */
export function ScreenHeading({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={`outline-none ${className}`}>
      {children}
    </h1>
  );
}
