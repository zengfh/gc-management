import { useEffect, useRef } from 'react';
import type { VoidHandler } from './appTypes';

const dialogFocusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocus(onClose: VoidHandler) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const previousFocus = document.activeElement;
    const focusableElements = (): HTMLElement[] =>
      [...dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector)].filter(
        (element) => !element.hasAttribute('aria-hidden'),
      );
    const initialFocus =
      dialog.querySelector<HTMLElement>('[data-autofocus]')
      || dialog.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      || focusableElements()[0]
      || dialog;

    initialFocus.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        return;
      }

      const first = elements[0] as HTMLElement;
      const last = elements[elements.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  }, [onClose]);

  return dialogRef;
}
