import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearQuery, invalidate, useQuery } from "../../src/shared/api/queryCache";

const key = "query-cache-test";

afterEach(() => clearQuery(key));

describe("shared query cache", () => {
  it("deduplicates reads and refetches mounted queries after invalidation", async () => {
    let value = 1;
    const fetcher = vi.fn(async () => value);
    const { result, unmount } = renderHook(() => useQuery(key, fetcher));

    await waitFor(() => expect(result.current.data).toBe(1));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    value = 2;
    act(() => invalidate([key]));
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
  });
});
