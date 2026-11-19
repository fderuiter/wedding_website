'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Checkbox } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import {
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  isEndTimeBeforeStartTime,
  formatSubEventSchedule,
} from '@/utils/dateTime';
import type { SubEventDTO } from '@/features/sub-events';

export interface EditableSubEvent {
  id: string;
  title: string;
  description?: string | null;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  locationName?: string | null;
  location?: string | null;
  category?: string | null;
  isPrivate: boolean;
}

interface SubEventEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingEvent?: EditableSubEvent | null;
  onSave: (_payload: Partial<SubEventDTO>, _editingId?: string) => Promise<unknown>;
  existingSubEvents?: EditableSubEvent[];
  onSelectEdit?: (_subEvent: EditableSubEvent | null) => void;
  onRequestDelete?: (_subEvent: EditableSubEvent) => void;
}

interface SubEventEditorFormProps {
  editingEvent: EditableSubEvent | null;
  onClose: () => void;
  onSave: (_payload: Partial<SubEventDTO>, _editingId?: string) => Promise<unknown>;
}

const SubEventEditorForm: React.FC<SubEventEditorFormProps> = ({
  editingEvent,
  onClose,
  onSave,
}) => {
  const { addToast } = useToast();
  const [title, setTitle] = useState(() => (editingEvent ? (editingEvent.title ?? '') : ''));
  const [description, setDescription] = useState(() =>
    editingEvent ? (editingEvent.description ?? '') : ''
  );
  const [locationName, setLocationName] = useState(() =>
    editingEvent ? (editingEvent.locationName ?? '') : ''
  );
  const [category, setCategory] = useState(() =>
    editingEvent ? (editingEvent.category ?? '') : ''
  );
  const [startTime, setStartTime] = useState(() =>
    editingEvent ? toDateTimeLocalValue(editingEvent.startTime) : ''
  );
  const [endTime, setEndTime] = useState(() =>
    editingEvent ? toDateTimeLocalValue(editingEvent.endTime) : ''
  );
  const [isPrivate, setIsPrivate] = useState(() =>
    editingEvent ? Boolean(editingEvent.isPrivate) : true
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEditMode = Boolean(editingEvent);
  const scheduleInvalid = isEndTimeBeforeStartTime(startTime, endTime);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      const msg = 'Sub-event title is required.';
      setValidationError(msg);
      addToast(msg, 'error');
      return;
    }

    if (isEndTimeBeforeStartTime(startTime, endTime)) {
      const msg = 'End time cannot precede start time.';
      setValidationError(msg);
      addToast(msg, 'error');
      return;
    }

    setValidationError(null);
    setIsSaving(true);

    try {
      const payload: Partial<SubEventDTO> = {
        title: title.trim(),
        description: isEditMode ? description.trim() : description.trim() || undefined,
        locationName: isEditMode ? locationName.trim() : locationName.trim() || undefined,
        category: isEditMode ? category.trim() : category.trim() || undefined,
        startTime: fromDateTimeLocalValue(startTime),
        endTime: fromDateTimeLocalValue(endTime),
        isPrivate,
      };

      await onSave(payload, editingEvent?.id);
      onClose();
    } catch (err: unknown) {
      setValidationError(
        err instanceof Error && err.message ? err.message : 'Failed to save sub-event.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {(validationError || scheduleInvalid) && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 font-medium"
        >
          {validationError || 'End time cannot precede start time.'}
        </div>
      )}

      <FormGroup>
        <Label>Title *</Label>
        <Input
          type="text"
          required
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (validationError) setValidationError(null);
          }}
          placeholder="e.g. Rehearsal Dinner"
        />
      </FormGroup>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormGroup>
          <Label>Start Time (Optional)</Label>
          <Input
            type="datetime-local"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              if (validationError) setValidationError(null);
            }}
          />
        </FormGroup>

        <FormGroup state={scheduleInvalid ? 'error' : 'default'}>
          <Label>End Time (Optional)</Label>
          <Input
            type="datetime-local"
            value={endTime}
            min={startTime || undefined}
            onChange={(e) => {
              setEndTime(e.target.value);
              if (validationError) setValidationError(null);
            }}
          />
        </FormGroup>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormGroup>
          <Label>Location Name</Label>
          <Input
            type="text"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. The Grand Ballroom"
          />
        </FormGroup>

        <FormGroup>
          <Label>Category</Label>
          <Input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Dining"
          />
        </FormGroup>
      </div>

      <FormGroup>
        <Label>Description</Label>
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Invitation-only dinner for wedding party"
        />
      </FormGroup>

      <FormGroup>
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <Label className="font-medium cursor-pointer">
            Private Sub-Event (requires explicit access assignment)
          </Label>
        </div>
      </FormGroup>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-zinc-800">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving
            ? 'Saving...'
            : isEditMode
              ? 'Save Changes'
              : 'Create Sub-Event'}
        </Button>
      </div>
    </form>
  );
};

export const SubEventEditorModal: React.FC<SubEventEditorModalProps> = ({
  isOpen,
  onClose,
  editingEvent = null,
  onSave,
  existingSubEvents,
  onSelectEdit,
  onRequestDelete,
}) => {
  if (!isOpen) return null;

  const isEditMode = Boolean(editingEvent);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Sub-Event' : 'Create New Sub-Event'}
      className="max-w-lg max-h-[90vh] flex flex-col"
      contentClassName="px-6 py-4 overflow-y-auto max-h-[78vh]"
    >
      <div className="space-y-5">
        {Array.isArray(existingSubEvents) && existingSubEvents.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50/70 dark:bg-zinc-800/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Existing Sub-Events ({existingSubEvents.length})
              </span>
              {isEditMode && onSelectEdit && (
                <button
                  type="button"
                  onClick={() => onSelectEdit(null)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  + Switch to Create New
                </button>
              )}
            </div>
            <ul className="divide-y divide-gray-200 dark:divide-zinc-700 max-h-40 overflow-y-auto">
              {existingSubEvents.map((evt) => {
                const scheduleText = formatSubEventSchedule(evt.startTime, evt.endTime);
                const isSelected = editingEvent?.id === evt.id;
                return (
                  <li
                    key={evt.id}
                    className={`py-2 px-1.5 flex items-center justify-between gap-2 text-sm rounded ${
                      isSelected ? 'bg-red-50/70 dark:bg-red-950/30' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold truncate text-gray-900 dark:text-white">
                          {evt.title}
                        </span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-gray-300">
                          {evt.isPrivate ? 'Private' : 'Public'}
                        </span>
                      </div>
                      {scheduleText && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {scheduleText}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onSelectEdit && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-label={`Edit sub-event ${evt.title}`}
                          onClick={() => onSelectEdit(evt)}
                        >
                          Edit
                        </Button>
                      )}
                      {onRequestDelete && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          aria-label={`Delete sub-event ${evt.title}`}
                          onClick={() => onRequestDelete(evt)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <SubEventEditorForm
          key={editingEvent?.id ?? 'create'}
          editingEvent={editingEvent}
          onClose={onClose}
          onSave={onSave}
        />
      </div>
    </Dialog>
  );
};

interface SubEventDeleteConfirmModalProps {
  subEvent: EditableSubEvent | null;
  onClose: () => void;
  onConfirm: (_subEvent: EditableSubEvent) => Promise<unknown>;
}

export const SubEventDeleteConfirmModal: React.FC<SubEventDeleteConfirmModalProps> = ({
  subEvent,
  onClose,
  onConfirm,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!subEvent) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm(subEvent);
      onClose();
    } catch {
      // Error feedback is handled by parent toast handler; keep modal open on failure
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      isOpen={Boolean(subEvent)}
      onClose={onClose}
      role="alertdialog"
      title="Delete Sub-Event"
      description={`Are you sure you want to delete "${subEvent.title}"? Guest access permissions and RSVP responses for this sub-event will be permanently removed.`}
      className="max-w-md"
    >
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isDeleting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={handleConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete Sub-Event'}
        </Button>
      </div>
    </Dialog>
  );
};
