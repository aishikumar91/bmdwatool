import { useEffect } from 'react';

import { APP_NAME } from '../constants/brand';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | BMDWATOOL" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | ${APP_NAME}`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
