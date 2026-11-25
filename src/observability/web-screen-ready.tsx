import type { ReactNode } from 'react';

export default function WebScreenReady({ children }: { children: ReactNode; onReady?: () => void }) {
  return <>{children}</>;
}
