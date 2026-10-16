import { renderHook, act } from '@testing-library/react';
import { useFormPersist } from '../useFormPersist';

describe('useFormPersist Hook', () => {
  const STORAGE_KEY = 'test_form_persist_key';

  beforeEach(() => {
    window.sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('initializes with initialValues when sessionStorage is empty', () => {
    const initialValues = { name: '', email: '' };
    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    expect(result.current[0]).toEqual(initialValues);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(initialValues));
  });

  it('restores persisted state from sessionStorage on mount', () => {
    const savedData = { name: 'Alice', email: 'alice@example.com' };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));

    const initialValues = { name: '', email: '' };
    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    expect(result.current[0]).toEqual(savedData);
  });

  it('merges stored object values with initialValues', () => {
    const savedData = { name: 'Bob' }; // email missing in saved data
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));

    const initialValues = { name: '', email: 'default@example.com', role: 'admin' };
    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    expect(result.current[0]).toEqual({
      name: 'Bob',
      email: 'default@example.com',
      role: 'admin',
    });
  });

  it('updates sessionStorage when state changes', () => {
    const initialValues = { partner1: 'Alex', partner2: '' };
    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    act(() => {
      const setState = result.current[1];
      setState((prev) => ({ ...prev, partner2: 'Sam' }));
    });

    expect(result.current[0]).toEqual({ partner1: 'Alex', partner2: 'Sam' });
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ partner1: 'Alex', partner2: 'Sam' })
    );
  });

  it('removes storage key when clearPersistedState is called', () => {
    const initialValues = { step: 2, title: 'Draft' };
    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => {
      const clearFn = result.current[2];
      clearFn();
    });

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back safely when sessionStorage contains invalid JSON', () => {
    window.sessionStorage.setItem(STORAGE_KEY, 'invalid-json-string{');

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const initialValues = { count: 1 };

    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    expect(result.current[0]).toEqual(initialValues);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('falls back gracefully when sessionStorage access throws an error (e.g. quota exceeded)', () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const initialValues = { notes: 'test' };
    const { result } = renderHook(() => useFormPersist(STORAGE_KEY, initialValues));

    act(() => {
      const setState = result.current[1];
      setState({ notes: 'updated' });
    });

    expect(result.current[0]).toEqual({ notes: 'updated' });
    expect(consoleSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('does not crash when disabled option is true', () => {
    const initialValues = { value: 'disabled-test' };
    const { result } = renderHook(() =>
      useFormPersist(STORAGE_KEY, initialValues, { enabled: false })
    );

    expect(result.current[0]).toEqual(initialValues);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
