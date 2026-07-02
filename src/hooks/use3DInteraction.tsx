import React, { useId, useState, useCallback, KeyboardEvent, useEffect } from 'react';

type Use3DInteractionOptions = {
  instructions: string;
  labels?: {
    up?: string;
    down?: string;
    left?: string;
    right?: string;
    action?: string;
  };
  onUp?: (e: KeyboardEvent<HTMLElement>) => void;
  onDown?: (e: KeyboardEvent<HTMLElement>) => void;
  onLeft?: (e: KeyboardEvent<HTMLElement>) => void;
  onRight?: (e: KeyboardEvent<HTMLElement>) => void;
  onAction?: (e: KeyboardEvent<HTMLElement>) => void;
};

export function use3DInteraction({
  instructions,
  labels = {},
  onUp,
  onDown,
  onLeft,
  onRight,
  onAction,
}: Use3DInteractionOptions) {
  const id = useId();
  const instructionsId = `3d-instructions-${id}`;
  const liveRegionId = `3d-live-${id}`;

  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const announce = useCallback((message: string) => {
    setLiveAnnouncement(message);
    // Clear the announcement after a short delay so the same message can be announced again if repeated
    setTimeout(() => setLiveAnnouncement(''), 1000);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      let handled = false;

      switch (e.key) {
        case 'ArrowUp':
          if (onUp) {
            e.preventDefault();
            onUp(e);
            if (labels.up) announce(labels.up);
            handled = true;
          }
          break;
        case 'ArrowDown':
          if (onDown) {
            e.preventDefault();
            onDown(e);
            if (labels.down) announce(labels.down);
            handled = true;
          }
          break;
        case 'ArrowLeft':
          if (onLeft) {
            e.preventDefault();
            onLeft(e);
            if (labels.left) announce(labels.left);
            handled = true;
          }
          break;
        case 'ArrowRight':
          if (onRight) {
            e.preventDefault();
            onRight(e);
            if (labels.right) announce(labels.right);
            handled = true;
          }
          break;
        case ' ':
        case 'Enter':
          if (onAction) {
            // Note: In some cases you might not want to prevent default for Enter/Space
            // if it's natively handled (like a button click).
            // But if onAction is provided, we assume custom handling.
            onAction(e);
            if (labels.action) announce(labels.action);
            // We'll let the caller decide if they want to prevent default inside onAction
          }
          break;
      }
      return handled;
    },
    [onUp, onDown, onLeft, onRight, onAction, labels, announce]
  );

  const getInteractiveProps = (originalProps: any = {}) => {
    const existingDescribedBy = originalProps['aria-describedby'];
    const mergedDescribedBy = existingDescribedBy 
      ? `${existingDescribedBy} ${instructionsId}`
      : instructionsId;

    return {
      'aria-describedby': mergedDescribedBy,
      onKeyDown: (e: KeyboardEvent<any>) => {
        handleKeyDown(e);
        if (originalProps.onKeyDown) {
          originalProps.onKeyDown(e);
        }
      },
    };
  };

  const AccessibleElements = (
    <>
      <div id={instructionsId} className="sr-only">
        {instructions}
      </div>
      <div id={liveRegionId} className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
    </>
  );

  return {
    getInteractiveProps,
    AccessibleElements,
  };
}
