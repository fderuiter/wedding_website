import { useState, useRef, useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { RegistryItem } from '../types';

const useOptionalToast = () => {
  try {
    return useToast();
  } catch {
    return null;
  }
};

export interface UseShareItemReturn {
  handleShare: (e?: { stopPropagation?: () => void; preventDefault?: () => void }) => Promise<void>;
  copied: boolean;
}

/**
 * Custom hook to handle sharing registry items using Web Share API,
 * clipboard fallback cascade, and toast notifications.
 *
 * @param item An object containing the item's id and name
 * @returns An object with handleShare function and copied state
 */
export function useShareItem(item: Pick<RegistryItem, 'id' | 'name'>): UseShareItemReturn {
  const [copied, setCopied] = useState(false);
  const toastContext = useOptionalToast();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleShare = useCallback(
    async (e?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();

      const permalink =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}?item=${encodeURIComponent(item.id)}`
          : `?item=${encodeURIComponent(item.id)}`;

      let success = false;

      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({
            title: item.name,
            text: `Check out ${item.name} on our wedding registry!`,
            url: permalink,
          });
          success = true;
        } catch (err: unknown) {
          if (
            typeof err === 'object' &&
            err !== null &&
            'name' in err &&
            (err as { name: string }).name === 'AbortError'
          ) {
            return;
          }
        }
      }

      if (!success && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(permalink);
          success = true;
        } catch {
          // Fallback
        }
      }

      if (!success && typeof document !== 'undefined') {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = permalink;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          success = true;
        } catch {
          // Fallback failed
        }
      }

      if (success) {
        setCopied(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => setCopied(false), 2000);
        toastContext?.addToast('Link copied to clipboard!', 'success');
      } else if (toastContext) {
        toastContext.addToast('Failed to copy link', 'error');
      }
    },
    [item.id, item.name, toastContext]
  );

  return { handleShare, copied };
}
