'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/utils/cn';

export interface GuestLookupHelpPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  initialGuestName?: string;
  initialEmail?: string;
  idPrefix?: string;
}

export const GuestLookupHelpPanel = React.forwardRef<HTMLDivElement, GuestLookupHelpPanelProps>(
  ({ initialGuestName = '', initialEmail = '', idPrefix = 'lookup-help', className, ...props }, ref) => {
    const [showAlertForm, setShowAlertForm] = useState(false);
    const [guestName, setGuestName] = useState(initialGuestName);
    const [guestEmail, setGuestEmail] = useState(initialEmail);
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [sentMessage, setSentMessage] = useState<string | null>(null);
    const [alertError, setAlertError] = useState<string | null>(null);

    const handleOpenAlertForm = () => {
      if (!guestName.trim() && initialGuestName.trim()) {
        setGuestName(initialGuestName.trim());
      }
      if (!guestEmail.trim() && initialEmail.trim()) {
        setGuestEmail(initialEmail.trim());
      }
      setShowAlertForm(true);
    };

    const handleSendHostAlert = async () => {
      const cleanName = guestName.trim();
      const cleanEmail = guestEmail.trim();
      if (!cleanName || !cleanEmail) {
        setAlertError('Please enter both your full name and email address so the hosts can reply.');
        return;
      }

      setIsSending(true);
      setAlertError(null);

      try {
        const res = await fetch('/api/guest/lookup/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guestName: cleanName,
            guestEmail: cleanEmail,
            message: message.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          setAlertError(
            json?.error || 'Unable to notify the hosts right now. Please try again in a moment.'
          );
          return;
        }
        setSentMessage(
          json.message ||
            'We notified the hosts! They will follow up with your invitation details shortly.'
        );
      } catch {
        setAlertError('A network error occurred while sending the alert. Please try again.');
      } finally {
        setIsSending(false);
      }
    };

    return (
      <div
        ref={ref}
        role="region"
        aria-labelledby={`${idPrefix}-heading`}
        data-testid="guest-lookup-help-panel"
        className={cn(
          'rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/30 p-4 text-gray-800 dark:text-zinc-100 space-y-3',
          className
        )}
        {...props}
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Icon
              name="HelpCircle"
              className="h-4 w-4 text-amber-800 dark:text-amber-300 shrink-0"
            />
            <h2
              id={`${idPrefix}-heading`}
              className="text-sm font-bold text-amber-950 dark:text-amber-100"
            >
              Spelling &amp; Name Lookup Tips
            </h2>
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-950/90 dark:text-amber-100/90 space-y-1">
            <li>
              Enter <strong>both your first and last name</strong> (single-word surnames will not
              match).
            </li>
            <li>
              Try the formal or nickname spelling printed on your envelope (for example,{' '}
              <em>Robert</em> vs. <em>Rob</em>, without honorifics like <em>Mr.</em> or <em>Dr.</em>{' '}
              unless printed as part of your name).
            </li>
            <li>
              Check hyphenated or married/maiden surnames, or try searching another adult member of
              your household.
            </li>
          </ul>
        </div>

        {sentMessage ? (
          <div
            role="status"
            data-testid="guest-lookup-alert-success"
            className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs font-medium text-emerald-900 dark:text-emerald-100"
          >
            {sentMessage}
          </div>
        ) : !showAlertForm ? (
          <div className="pt-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleOpenAlertForm}
              data-testid="open-host-alert-button"
            >
              Still can&apos;t find your name? Notify the Hosts
            </Button>
          </div>
        ) : (
          <div
            className="pt-2 border-t border-amber-200 dark:border-amber-800/80 space-y-3"
            data-testid="guest-lookup-alert-form"
          >
            <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
              Send a quick automated alert so the hosts can check your spelling or share your
              invitation code:
            </p>

            {alertError && (
              <div
                role="alert"
                data-testid="guest-lookup-alert-error"
                className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-2.5 text-xs font-medium text-rose-800 dark:text-rose-200"
              >
                {alertError}
              </div>
            )}

            <div className="space-y-2.5">
              <FormGroup className="space-y-1">
                <Label htmlFor={`${idPrefix}-guest-name`} className="text-xs mb-0">
                  Your Full Name
                </Label>
                <Input
                  id={`${idPrefix}-guest-name`}
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Alex Rivera"
                  disabled={isSending}
                />
              </FormGroup>

              <FormGroup className="space-y-1">
                <Label htmlFor={`${idPrefix}-guest-email`} className="text-xs mb-0">
                  Your Email Address
                </Label>
                <Input
                  id={`${idPrefix}-guest-email`}
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isSending}
                />
              </FormGroup>

              <FormGroup className="space-y-1">
                <Label htmlFor={`${idPrefix}-guest-note`} className="text-xs mb-0">
                  Note for Hosts (Optional)
                </Label>
                <Input
                  id={`${idPrefix}-guest-note`}
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Invited with Sam Rivera"
                  disabled={isSending}
                />
              </FormGroup>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSendHostAlert()}
                  disabled={isSending}
                  data-testid="submit-host-alert-button"
                >
                  {isSending ? 'Sending Alert...' : 'Send Alert to Hosts'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAlertForm(false);
                    setAlertError(null);
                  }}
                  disabled={isSending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

GuestLookupHelpPanel.displayName = 'GuestLookupHelpPanel';
