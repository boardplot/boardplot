import { useEffect, useLayoutEffect } from 'react';

/** Keep browser measurements before paint without React 18's server warning. */
export const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
