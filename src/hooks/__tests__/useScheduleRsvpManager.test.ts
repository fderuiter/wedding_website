import { renderHook, act } from '@testing-library/react';
import { useScheduleRsvpManager, type EventRsvpFiniteState } from '../useScheduleRsvpManager';

describe('useScheduleRsvpManager', () => {
  const sampleEvents = [
    {
      id: 'event-1',
      title: 'Ceremony',
      userRsvp: {
        status: 'pending' as const,
        plusOneCount: 0,
        dietaryNotes: '',
      },
    },
    {
      id: 'event-2',
      title: 'Reception',
      userRsvp: {
        status: 'attending' as const,
        plusOneCount: 1,
        dietaryNotes: 'Vegetarian',
      },
    },
  ];

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('initializes finite state machines and baselines accurately', () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    const event1 = result.current.getRsvpState('event-1');
    const expectedIdle: EventRsvpFiniteState = 'idle';
    expect(event1.state).toBe(expectedIdle);
    expect(event1.isDirty).toBe(false);
    expect(event1.current.status).toBe('pending');
    expect(event1.baseline.status).toBe('pending');

    const event2 = result.current.getRsvpState('event-2');
    expect(event2.state).toBe('idle');
    expect(event2.isDirty).toBe(false);
    expect(event2.current.status).toBe('attending');
    expect(event2.current.plusOneCount).toBe(1);
    expect(event2.current.dietaryNotes).toBe('Vegetarian');

    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.isDirty).toBe(false);
  });

  it('transitions state to dirty when user updates attendance or notes, and clears prior banners', () => {
    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
    });

    const event1 = result.current.getRsvpState('event-1');
    expect(event1.state).toBe('dirty');
    expect(event1.isDirty).toBe(true);
    expect(event1.current.status).toBe('attending');
    expect(result.current.dirtyCount).toBe(1);
    expect(result.current.dirtyEventIds).toEqual(['event-1']);

    // Changing it back to baseline restores idle state
    act(() => {
      result.current.updateRsvp('event-1', { status: 'pending' });
    });
    expect(result.current.getRsvpState('event-1').state).toBe('idle');
    expect(result.current.getRsvpState('event-1').isDirty).toBe(false);
    expect(result.current.dirtyCount).toBe(0);
  });

  it('submits single event and synchronizes baseline state upon success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'rsvp-1',
            subEventId: 'event-1',
            status: 'attending',
            plusOneCount: 2,
            dietaryNotes: 'No nuts',
          },
        ],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', {
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'No nuts',
      });
    });

    let success = false;
    await act(async () => {
      success = await result.current.submitSingle('event-1');
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subEventId: 'event-1',
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'No nuts',
      }),
    });

    const event1 = result.current.getRsvpState('event-1');
    expect(event1.state).toBe('success');
    expect(event1.isDirty).toBe(false);
    expect(event1.baseline.status).toBe('attending');
    expect(event1.baseline.plusOneCount).toBe(2);
    expect(event1.baseline.dietaryNotes).toBe('No nuts');
    expect(event1.message).toBe('RSVP submitted successfully!');
    expect(result.current.liveMessage).toBe('Successfully saved RSVP.');
  });

  it('dispatches batch submissions conforming to SubEventRsvpBatchSubmissionSchema', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'rsvp-1',
            subEventId: 'event-1',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
          },
          {
            id: 'rsvp-2',
            subEventId: 'event-2',
            status: 'declined',
            plusOneCount: 0,
            dietaryNotes: '',
          },
        ],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
      result.current.updateRsvp('event-2', { status: 'declined', plusOneCount: 0, dietaryNotes: '' });
    });

    expect(result.current.dirtyCount).toBe(2);

    let success = false;
    await act(async () => {
      success = await result.current.submitBatch();
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rsvps: [
          {
            subEventId: 'event-1',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
          },
          {
            subEventId: 'event-2',
            status: 'declined',
            plusOneCount: 0,
            dietaryNotes: '',
          },
        ],
      }),
    });

    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.getRsvpState('event-1').state).toBe('success');
    expect(result.current.getRsvpState('event-2').state).toBe('success');
    expect(result.current.liveMessage).toBe('Successfully saved RSVPs for 2 events.');
  });

  it('rolls back to error state and preserves user edits on batch failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Network timeout occurred.',
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending', dietaryNotes: 'Halal' });
    });

    let success = false;
    await act(async () => {
      success = await result.current.submitBatch();
    });

    expect(success).toBe(false);
    expect(result.current.batchError).toBe('Network timeout occurred.');
    expect(result.current.liveMessage).toContain('Network timeout occurred.');

    const event1 = result.current.getRsvpState('event-1');
    expect(event1.state).toBe('error');
    expect(event1.error).toBe('Network timeout occurred.');
    // User pending edits are preserved
    expect(event1.current.status).toBe('attending');
    expect(event1.current.dietaryNotes).toBe('Halal');
    expect(event1.isDirty).toBe(true);
  });

  it('clears stale error and success messages when user makes a modification', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'rsvp-1', subEventId: 'event-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' }],
      }),
    });

    const { result } = renderHook(() =>
      useScheduleRsvpManager({ initialEvents: sampleEvents })
    );

    act(() => {
      result.current.updateRsvp('event-1', { status: 'attending' });
    });

    await act(async () => {
      await result.current.submitSingle('event-1');
    });

    expect(result.current.getRsvpState('event-1').message).toBe('RSVP submitted successfully!');

    // User modifies note: stale message should immediately be cleared
    act(() => {
      result.current.updateRsvp('event-1', { dietaryNotes: 'Vegan only' });
    });

    const updated = result.current.getRsvpState('event-1');
    expect(updated.message).toBeNull();
    expect(updated.error).toBeNull();
    expect(updated.state).toBe('dirty');
  });
});
