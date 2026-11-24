import { createContext, createElement, Fragment, type ReactNode } from 'react';
import type { DemoContextValue } from './DemoContext';

export const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return createElement(Fragment, null, children);
}

export function useOptionalDemo(): DemoContextValue | null {
  return null;
}
