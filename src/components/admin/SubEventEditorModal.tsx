'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Checkbox, Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import {
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  isEndTimeBeforeStartTime,
  formatSubEventSchedule,
} from '@/utils/dateTime';
import {
  DIETARY_TAG_OPTIONS,
  normalizeMealOptions,
  normalizeCustomQuestions,
} from '@/utils/rsvpPrompts';
import type {
  SubEventDTO,
  MealOptionDTO,
  CustomRsvpQuestionDTO,
} from '@/features/sub-events';

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
  mealOptions?: MealOptionDTO[];
  customQuestions?: CustomRsvpQuestionDTO[];
}

function createDraftId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

interface SubEventEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingEvent?: EditableSubEvent | null;
  onSave: (
    _payload: Partial<SubEventDTO> & { choiceRenames?: Record<string, Record<string, string>> },
    _editingId?: string
  ) => Promise<unknown>;
  existingSubEvents?: EditableSubEvent[];
  onSelectEdit?: (_subEvent: EditableSubEvent | null) => void;
  onRequestDelete?: (_subEvent: EditableSubEvent) => void;
}

interface SubEventFormSnapshot {
  title: string;
  description: string;
  locationName: string;
  category: string;
  startTime: string;
  endTime: string;
  isPrivate: boolean;
  mealOptionsJson: string;
  customQuestionsJson: string;
}

function createInitialSubEventSnapshot(editingEvent: EditableSubEvent | null): SubEventFormSnapshot {
  const initialMeals = editingEvent ? normalizeMealOptions(editingEvent.mealOptions) : [];
  const initialQuestions = editingEvent
    ? normalizeCustomQuestions(editingEvent.customQuestions)
    : [];
  return {
    title: editingEvent ? (editingEvent.title ?? '') : '',
    description: editingEvent ? (editingEvent.description ?? '') : '',
    locationName: editingEvent ? (editingEvent.locationName ?? '') : '',
    category: editingEvent ? (editingEvent.category ?? '') : '',
    startTime: editingEvent ? toDateTimeLocalValue(editingEvent.startTime) : '',
    endTime: editingEvent ? toDateTimeLocalValue(editingEvent.endTime) : '',
    isPrivate: editingEvent ? Boolean(editingEvent.isPrivate) : true,
    mealOptionsJson: JSON.stringify(initialMeals),
    customQuestionsJson: JSON.stringify(initialQuestions),
  };
}

function isSubEventDirty(current: SubEventFormSnapshot, initial: SubEventFormSnapshot): boolean {
  return (Object.keys(initial) as Array<keyof SubEventFormSnapshot>).some(
    (key) => current[key] !== initial[key]
  );
}

interface SubEventEditorFormProps {
  editingEvent: EditableSubEvent | null;
  onClose: () => void;
  onSave: (_payload: Partial<SubEventDTO> & { choiceRenames?: Record<string, Record<string, string>> }, _editingId?: string) => Promise<unknown>;
  onDirtyChange: (_isDirty: boolean) => void;
  existingEventsSection?: React.ReactNode;
}

const SubEventEditorForm: React.FC<SubEventEditorFormProps> = ({
  editingEvent,
  onClose,
  onSave,
  onDirtyChange,
  existingEventsSection,
}) => {
  const { addToast } = useToast();
  const initialSnapshot = useMemo(
    () => createInitialSubEventSnapshot(editingEvent),
    [editingEvent]
  );
  const [title, setTitle] = useState(() => initialSnapshot.title);
  const [description, setDescription] = useState(() => initialSnapshot.description);
  const [locationName, setLocationName] = useState(() => initialSnapshot.locationName);
  const [category, setCategory] = useState(() => initialSnapshot.category);
  const [startTime, setStartTime] = useState(() => initialSnapshot.startTime);
  const [endTime, setEndTime] = useState(() => initialSnapshot.endTime);
  const [isPrivate, setIsPrivate] = useState(() => initialSnapshot.isPrivate);
  const [mealOptions, setMealOptions] = useState<MealOptionDTO[]>(() =>
    editingEvent ? normalizeMealOptions(editingEvent.mealOptions) : []
  );
  const [customQuestions, setCustomQuestions] = useState<CustomRsvpQuestionDTO[]>(() =>
    editingEvent ? normalizeCustomQuestions(editingEvent.customQuestions) : []
  );
  const [choiceOrigins, setChoiceOrigins] = useState<Record<string, Array<string | null>>>(() => {
    if (!editingEvent) return {};
    const initial = normalizeCustomQuestions(editingEvent.customQuestions);
    const origins: Record<string, Array<string | null>> = {};
    for (const q of initial) {
      if (q.type === 'choice') {
        origins[q.id] = q.options.map((opt) => opt.trim() || null);
      }
    }
    return origins;
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currentSnapshot: SubEventFormSnapshot = {
    title,
    description,
    locationName,
    category,
    startTime,
    endTime,
    isPrivate,
    mealOptionsJson: JSON.stringify(mealOptions),
    customQuestionsJson: JSON.stringify(customQuestions),
  };
  const isDirty = isSubEventDirty(currentSnapshot, initialSnapshot);
  const handleRequestClose = useDirtyConfirmClose(isDirty, onClose);

  const updateSnapshotField = <K extends keyof SubEventFormSnapshot>(
    field: K,
    value: SubEventFormSnapshot[K]
  ) => {
    const next = { ...currentSnapshot, [field]: value };
    onDirtyChange(isSubEventDirty(next, initialSnapshot));
  };

  const applyNextMealOptions = (nextMeals: MealOptionDTO[]) => {
    setMealOptions(nextMeals);
    updateSnapshotField('mealOptionsJson', JSON.stringify(nextMeals));
  };

  const applyNextCustomQuestions = (nextQuestions: CustomRsvpQuestionDTO[]) => {
    setCustomQuestions(nextQuestions);
    updateSnapshotField('customQuestionsJson', JSON.stringify(nextQuestions));
  };

  const isEditMode = Boolean(editingEvent);
  const scheduleInvalid = isEndTimeBeforeStartTime(startTime, endTime);

  const handleAddMealOption = () => {
    applyNextMealOptions([
      ...mealOptions,
      {
        id: createDraftId('meal'),
        label: '',
        description: '',
        dietaryTags: [],
      },
    ]);
    if (validationError) setValidationError(null);
  };

  const handleUpdateMealOption = (index: number, patch: Partial<MealOptionDTO>) => {
    applyNextMealOptions(
      mealOptions.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
    if (validationError) setValidationError(null);
  };

  const handleToggleMealTag = (index: number, tag: string) => {
    applyNextMealOptions(
      mealOptions.map((item, idx) => {
        if (idx !== index) return item;
        const exists = item.dietaryTags.includes(tag);
        const nextTags = exists
          ? item.dietaryTags.filter((t) => t !== tag)
          : [...item.dietaryTags, tag];
        return { ...item, dietaryTags: nextTags };
      })
    );
  };

  const handleMoveMealOption = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= mealOptions.length) return;
    const next = [...mealOptions];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    applyNextMealOptions(next);
  };

  const handleRemoveMealOption = (index: number) => {
    applyNextMealOptions(mealOptions.filter((_, idx) => idx !== index));
    if (validationError) setValidationError(null);
  };

  const handleAddCustomQuestion = () => {
    applyNextCustomQuestions([
      ...customQuestions,
      {
        id: createDraftId('question'),
        prompt: '',
        type: 'text',
        required: false,
        options: [],
      },
    ]);
    if (validationError) setValidationError(null);
  };

  const handleUpdateCustomQuestion = (
    index: number,
    patch: Partial<CustomRsvpQuestionDTO>
  ) => {
    const targetQuestion = customQuestions[index];
    if (targetQuestion && patch.type !== undefined && patch.type !== targetQuestion.type) {
      setChoiceOrigins((prev) => {
        const next = { ...prev };
        if (patch.type === 'text') {
          next[targetQuestion.id] = [];
        } else if (patch.type === 'choice' && (!next[targetQuestion.id] || next[targetQuestion.id].length === 0)) {
          next[targetQuestion.id] = [null, null];
        }
        return next;
      });
    }
    applyNextCustomQuestions(
      customQuestions.map((item, idx) => {
        if (idx !== index) return item;
        const nextType = patch.type ?? item.type;
        let nextOptions = patch.options ?? item.options;
        if (nextType === 'choice' && nextOptions.length === 0 && patch.options === undefined) {
          nextOptions = ['', ''];
        }
        if (nextType === 'text' && patch.type === 'text') {
          nextOptions = [];
        }
        return { ...item, ...patch, type: nextType, options: nextOptions };
      })
    );
    if (validationError) setValidationError(null);
  };

  const handleMoveCustomQuestion = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= customQuestions.length) return;
    const next = [...customQuestions];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    applyNextCustomQuestions(next);
  };

  const handleRemoveCustomQuestion = (index: number) => {
    const removed = customQuestions[index];
    if (removed) {
      setChoiceOrigins((prev) => {
        const next = { ...prev };
        delete next[removed.id];
        return next;
      });
    }
    applyNextCustomQuestions(customQuestions.filter((_, idx) => idx !== index));
    if (validationError) setValidationError(null);
  };

  const handleAddQuestionChoice = (questionIndex: number) => {
    const targetQuestion = customQuestions[questionIndex];
    if (targetQuestion) {
      setChoiceOrigins((prev) => ({
        ...prev,
        [targetQuestion.id]: [...(prev[targetQuestion.id] ?? targetQuestion.options.map(() => null)), null],
      }));
    }
    applyNextCustomQuestions(
      customQuestions.map((item, idx) =>
        idx === questionIndex ? { ...item, options: [...item.options, ''] } : item
      )
    );
    if (validationError) setValidationError(null);
  };

  const handleUpdateQuestionChoice = (
    questionIndex: number,
    choiceIndex: number,
    value: string
  ) => {
    applyNextCustomQuestions(
      customQuestions.map((item, idx) => {
        if (idx !== questionIndex) return item;
        const nextOptions = item.options.map((opt, cIdx) =>
          cIdx === choiceIndex ? value : opt
        );
        return { ...item, options: nextOptions };
      })
    );
    if (validationError) setValidationError(null);
  };

  const handleRemoveQuestionChoice = (questionIndex: number, choiceIndex: number) => {
    const targetQuestion = customQuestions[questionIndex];
    if (targetQuestion) {
      setChoiceOrigins((prev) => {
        const existingOrigins = prev[targetQuestion.id];
        if (!existingOrigins) return prev;
        return {
          ...prev,
          [targetQuestion.id]: existingOrigins.filter((_, cIdx) => cIdx !== choiceIndex),
        };
      });
    }
    applyNextCustomQuestions(
      customQuestions.map((item, idx) =>
        idx === questionIndex
          ? { ...item, options: item.options.filter((_, cIdx) => cIdx !== choiceIndex) }
          : item
      )
    );
    if (validationError) setValidationError(null);
  };

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

    for (let i = 0; i < mealOptions.length; i++) {
      if (!mealOptions[i].label.trim()) {
        const msg = `Meal option #${i + 1} requires an entrée name.`;
        setValidationError(msg);
        addToast(msg, 'error');
        return;
      }
    }

    for (let i = 0; i < customQuestions.length; i++) {
      const q = customQuestions[i];
      if (!q.prompt.trim()) {
        const msg = `Custom RSVP question #${i + 1} requires a prompt.`;
        setValidationError(msg);
        addToast(msg, 'error');
        return;
      }
      if (q.type === 'choice') {
        const validChoices = q.options.map((opt) => opt.trim()).filter(Boolean);
        if (validChoices.length === 0) {
          const msg = `Multiple-choice question "${q.prompt.trim()}" requires at least one choice option.`;
          setValidationError(msg);
          addToast(msg, 'error');
          return;
        }
      }
    }

    const cleanedMeals: MealOptionDTO[] = mealOptions.map((item) => ({
      id: item.id.trim() || createDraftId('meal'),
      label: item.label.trim(),
      description: (item.description ?? '').trim(),
      dietaryTags: Array.from(
        new Set(item.dietaryTags.map((t) => t.trim().toLowerCase()).filter(Boolean))
      ),
    }));

    const cleanedQuestions: CustomRsvpQuestionDTO[] = customQuestions.map((item) => ({
      id: item.id.trim() || createDraftId('question'),
      prompt: item.prompt.trim(),
      type: item.type,
      required: Boolean(item.required),
      options:
        item.type === 'choice'
          ? Array.from(new Set(item.options.map((opt) => opt.trim()).filter(Boolean)))
          : [],
    }));

    const choiceRenames: Record<string, Record<string, string>> = {};
    if (isEditMode) {
      for (const item of customQuestions) {
        if (item.type !== 'choice') continue;
        const qId = item.id.trim();
        if (!qId) continue;
        const origins = choiceOrigins[item.id] ?? [];
        const cleanedOptsForQuestion = Array.from(
          new Set(item.options.map((opt) => opt.trim()).filter(Boolean))
        );
        const questionRenames: Record<string, string> = {};
        for (let cIdx = 0; cIdx < item.options.length; cIdx++) {
          const origin = origins[cIdx]?.trim();
          const nextVal = item.options[cIdx]?.trim();
          if (
            origin &&
            nextVal &&
            origin !== nextVal &&
            !cleanedOptsForQuestion.includes(origin)
          ) {
            questionRenames[origin] = nextVal;
          }
        }
        if (Object.keys(questionRenames).length > 0) {
          choiceRenames[qId] = questionRenames;
        }
      }
    }

    setValidationError(null);
    setIsSaving(true);

    try {
      const payload: Partial<SubEventDTO> & {
        choiceRenames?: Record<string, Record<string, string>>;
      } = {
        title: title.trim(),
        description: isEditMode ? description.trim() : description.trim() || undefined,
        locationName: isEditMode ? locationName.trim() : locationName.trim() || undefined,
        category: isEditMode ? category.trim() : category.trim() || undefined,
        startTime: fromDateTimeLocalValue(startTime),
        endTime: fromDateTimeLocalValue(endTime),
        isPrivate,
        mealOptions: cleanedMeals,
        customQuestions: cleanedQuestions,
      };
      if (Object.keys(choiceRenames).length > 0) {
        payload.choiceRenames = choiceRenames;
      }

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
            const val = e.target.value;
            setTitle(val);
            updateSnapshotField('title', val);
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
              const val = e.target.value;
              setStartTime(val);
              updateSnapshotField('startTime', val);
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
              const val = e.target.value;
              setEndTime(val);
              updateSnapshotField('endTime', val);
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
            onChange={(e) => {
              const val = e.target.value;
              setLocationName(val);
              updateSnapshotField('locationName', val);
            }}
            placeholder="e.g. The Grand Ballroom"
          />
        </FormGroup>

        <FormGroup>
          <Label>Category</Label>
          <Input
            type="text"
            value={category}
            onChange={(e) => {
              const val = e.target.value;
              setCategory(val);
              updateSnapshotField('category', val);
            }}
            placeholder="e.g. Dining"
          />
        </FormGroup>
      </div>

      <FormGroup>
        <Label>Description</Label>
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => {
            const val = e.target.value;
            setDescription(val);
            updateSnapshotField('description', val);
          }}
          placeholder="e.g. Invitation-only dinner for wedding party"
        />
      </FormGroup>

      <FormGroup>
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            checked={isPrivate}
            onChange={(e) => {
              const val = e.target.checked;
              setIsPrivate(val);
              updateSnapshotField('isPrivate', val);
            }}
          />
          <Label className="font-medium cursor-pointer">
            Private Sub-Event (requires explicit access assignment)
          </Label>
        </div>
      </FormGroup>

      {/* Entrée / Meal Options List Editor */}
      <div
        className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50/60 dark:bg-zinc-800/40 p-3.5 space-y-3"
        data-testid="meal-options-editor"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100">
              Entrée / Meal Options ({mealOptions.length})
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Optional: configure plated dinner entrées and dietary tags for attending guests.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAddMealOption}
            disabled={isSaving}
          >
            + Add Meal Option
          </Button>
        </div>

        {mealOptions.length > 0 && (
          <div className="space-y-3">
            {mealOptions.map((option, index) => (
              <div
                key={option.id}
                className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/70 p-3 space-y-2.5"
                data-testid={`meal-option-row-${index}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-300">
                    Meal Option #{index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Move meal option ${option.label || `#${index + 1}`} up`}
                      disabled={index === 0 || isSaving}
                      onClick={() => handleMoveMealOption(index, -1)}
                    >
                      ↑ Up
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Move meal option ${option.label || `#${index + 1}`} down`}
                      disabled={index === mealOptions.length - 1 || isSaving}
                      onClick={() => handleMoveMealOption(index, 1)}
                    >
                      ↓ Down
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      aria-label={`Remove meal option ${option.label || `#${index + 1}`}`}
                      disabled={isSaving}
                      onClick={() => handleRemoveMealOption(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormGroup>
                    <Label htmlFor={`meal-label-${option.id}`}>Entrée Name *</Label>
                    <Input
                      id={`meal-label-${option.id}`}
                      type="text"
                      value={option.label}
                      onChange={(e) =>
                        handleUpdateMealOption(index, { label: e.target.value })
                      }
                      placeholder="e.g. Herb-Crusted Salmon"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor={`meal-desc-${option.id}`}>Description (Optional)</Label>
                    <Input
                      id={`meal-desc-${option.id}`}
                      type="text"
                      value={option.description || ''}
                      onChange={(e) =>
                        handleUpdateMealOption(index, { description: e.target.value })
                      }
                      placeholder="e.g. Wild rice & lemon butter"
                    />
                  </FormGroup>
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                    Dietary Tags
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {DIETARY_TAG_OPTIONS.map((tag) => {
                      const checked = option.dietaryTags.includes(tag);
                      return (
                        <label
                          key={tag}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                            checked
                              ? 'border-red-600 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/50 dark:text-red-200'
                              : 'border-gray-300 bg-white text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-gray-300 text-red-700 focus:ring-red-600"
                            checked={checked}
                            onChange={() => handleToggleMealTag(index, tag)}
                          />
                          <span>{tag}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom RSVP Questions List Editor */}
      <div
        className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50/60 dark:bg-zinc-800/40 p-3.5 space-y-3"
        data-testid="custom-questions-editor"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100">
              Custom RSVP Questions ({customQuestions.length})
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Optional: ask attending guests text or multiple-choice prompts (e.g. shuttle, song requests).
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAddCustomQuestion}
            disabled={isSaving}
          >
            + Add Question
          </Button>
        </div>

        {customQuestions.length > 0 && (
          <div className="space-y-3">
            {customQuestions.map((question, index) => (
              <div
                key={question.id}
                className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/70 p-3 space-y-2.5"
                data-testid={`custom-question-row-${index}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-300">
                    Question #{index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Move question ${question.prompt || `#${index + 1}`} up`}
                      disabled={index === 0 || isSaving}
                      onClick={() => handleMoveCustomQuestion(index, -1)}
                    >
                      ↑ Up
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Move question ${question.prompt || `#${index + 1}`} down`}
                      disabled={index === customQuestions.length - 1 || isSaving}
                      onClick={() => handleMoveCustomQuestion(index, 1)}
                    >
                      ↓ Down
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      aria-label={`Remove question ${question.prompt || `#${index + 1}`}`}
                      disabled={isSaving}
                      onClick={() => handleRemoveCustomQuestion(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <FormGroup>
                  <Label htmlFor={`question-prompt-${question.id}`}>Question Prompt *</Label>
                  <Input
                    id={`question-prompt-${question.id}`}
                    type="text"
                    value={question.prompt}
                    onChange={(e) =>
                      handleUpdateCustomQuestion(index, { prompt: e.target.value })
                    }
                    placeholder="e.g. Will you use the hotel shuttle?"
                  />
                </FormGroup>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <FormGroup>
                    <Label htmlFor={`question-type-${question.id}`}>Response Type</Label>
                    <Select
                      id={`question-type-${question.id}`}
                      value={question.type}
                      onChange={(e) =>
                        handleUpdateCustomQuestion(index, {
                          type: e.target.value === 'choice' ? 'choice' : 'text',
                        })
                      }
                    >
                      <option value="text">Free-text answer</option>
                      <option value="choice">Multiple choice</option>
                    </Select>
                  </FormGroup>

                  <FormGroup>
                    <div className="flex items-center gap-2 sm:pt-5">
                      <Checkbox
                        id={`question-required-${question.id}`}
                        checked={question.required}
                        onChange={(e) =>
                          handleUpdateCustomQuestion(index, { required: e.target.checked })
                        }
                      />
                      <Label
                        htmlFor={`question-required-${question.id}`}
                        className="font-medium cursor-pointer"
                      >
                        Required for attending guests
                      </Label>
                    </div>
                  </FormGroup>
                </div>

                {question.type === 'choice' && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                        Choice Options *
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleAddQuestionChoice(index)}
                        disabled={isSaving}
                      >
                        + Add Choice
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {question.options.map((choiceVal, cIdx) => (
                        <div key={`${question.id}-opt-${cIdx}`} className="flex items-center gap-2">
                          <label
                            htmlFor={`question-${question.id}-choice-${cIdx}`}
                            className="sr-only"
                          >
                            {`Question ${index + 1} choice ${cIdx + 1}`}
                          </label>
                          <Input
                            id={`question-${question.id}-choice-${cIdx}`}
                            type="text"
                            value={choiceVal}
                            onChange={(e) =>
                              handleUpdateQuestionChoice(index, cIdx, e.target.value)
                            }
                            placeholder={`Choice #${cIdx + 1} (e.g. Yes, round-trip)`}
                          />
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            aria-label={`Remove choice ${cIdx + 1} from question ${index + 1}`}
                            disabled={question.options.length <= 1 || isSaving}
                            onClick={() => handleRemoveQuestionChoice(index, cIdx)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {existingEventsSection}

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-zinc-800">
        <Button type="button" variant="secondary" onClick={handleRequestClose} disabled={isSaving}>
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

interface SubEventEditorModalBodyProps {
  editingEvent: EditableSubEvent | null;
  onClose: () => void;
  onSave: (_payload: Partial<SubEventDTO> & { choiceRenames?: Record<string, Record<string, string>> }, _editingId?: string) => Promise<unknown>;
  existingSubEvents?: EditableSubEvent[];
  onSelectEdit?: (_subEvent: EditableSubEvent | null) => void;
  onRequestDelete?: (_subEvent: EditableSubEvent) => void;
  isDirty: boolean;
  onDirtyChange: (_isDirty: boolean) => void;
}

const SubEventEditorModalBody: React.FC<SubEventEditorModalBodyProps> = ({
  editingEvent,
  onClose,
  onSave,
  existingSubEvents,
  onSelectEdit,
  onRequestDelete,
  isDirty,
  onDirtyChange,
}) => {
  const { confirm } = useToast();
  const isEditMode = Boolean(editingEvent);

  const handleSelectEdit = async (target: EditableSubEvent | null) => {
    if (!onSelectEdit) return;
    if ((target?.id ?? null) === (editingEvent?.id ?? null)) return;
    if (isDirty) {
      const confirmed = await confirm(
        'You have unsaved changes. Are you sure you want to discard them?'
      );
      if (!confirmed) return;
    }
    onSelectEdit(target);
  };

  const existingEventsSection =
    Array.isArray(existingSubEvents) && existingSubEvents.length > 0 ? (
      <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50/70 dark:bg-zinc-800/50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Existing Sub-Events ({existingSubEvents.length})
          </span>
          {isEditMode && onSelectEdit && (
            <button
              type="button"
              onClick={() => void handleSelectEdit(null)}
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
                      onClick={() => void handleSelectEdit(evt)}
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
    ) : null;

  return (
    <div className="space-y-5">
      <SubEventEditorForm
        key={editingEvent?.id ?? 'create'}
        editingEvent={editingEvent}
        onClose={onClose}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
        existingEventsSection={existingEventsSection}
      />
    </div>
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
  const [dirtyEntry, setDirtyEntry] = useState<{ key: string; isDirty: boolean }>({
    key: '',
    isDirty: false,
  });

  if (!isOpen) return null;

  const isEditMode = Boolean(editingEvent);
  const editingKey = editingEvent?.id ?? 'create';
  const isDirty = dirtyEntry.key === editingKey && dirtyEntry.isDirty;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      isDirty={isDirty}
      title={isEditMode ? 'Edit Sub-Event' : 'Create New Sub-Event'}
      className="max-w-2xl max-h-[90vh] flex flex-col"
      contentClassName="px-6 py-4 overflow-y-auto max-h-[78vh]"
    >
      <SubEventEditorModalBody
        editingEvent={editingEvent}
        onClose={onClose}
        onSave={onSave}
        existingSubEvents={existingSubEvents}
        onSelectEdit={onSelectEdit}
        onRequestDelete={onRequestDelete}
        isDirty={isDirty}
        onDirtyChange={(nextDirty) => setDirtyEntry({ key: editingKey, isDirty: nextDirty })}
      />
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
