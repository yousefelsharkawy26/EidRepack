import { useCallback, useEffect, useState } from "react";

const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

export function fetchQuery<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const generation = generations.get(key) || 0;
  const request = fetcher().then((value) => {
    if ((generations.get(key) || 0) === generation) cache.set(key, value);
    return value;
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

export function invalidate(keys: readonly string[]) {
  for (const key of keys) {
    cache.delete(key);
    pending.delete(key);
    generations.set(key, (generations.get(key) || 0) + 1);
    listeners.get(key)?.forEach((listener) => listener());
  }
}

export function clearQuery(key: string) {
  cache.delete(key);
  pending.delete(key);
  generations.set(key, (generations.get(key) || 0) + 1);
}

interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true) {
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: null, loading: false });
  const refetch = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await fetchQuery(key, fetcher);
      setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      setState((current) => ({ ...current, error, loading: false }));
      throw error;
    }
  }, [key, fetcher]);

  useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: null, loading: false });
      return;
    }
    const keyListeners = listeners.get(key) || new Set<() => void>();
    const onInvalidate = () => { void refetch().catch(() => undefined); };
    keyListeners.add(onInvalidate);
    listeners.set(key, keyListeners);
    void refetch().catch(() => undefined);
    return () => {
      keyListeners.delete(onInvalidate);
      if (keyListeners.size === 0) listeners.delete(key);
    };
  }, [enabled, key, refetch]);

  return { ...state, refetch };
}
