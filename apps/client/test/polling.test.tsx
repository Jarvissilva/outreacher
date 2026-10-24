import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { usePolling } from '@/lib/route-data';

it('waits for each refresh to finish and stops polling on unmount', async () => {
  vi.useFakeTimers();
  let finish = () => {};
  const loader = vi.fn(async () => {
    if (loader.mock.calls.length > 1) {
      await new Promise<void>(resolve => { finish = resolve; });
    }
    return null;
  });
  function Page() {
    usePolling(100);
    return <p>Polling</p>;
  }
  const router = createMemoryRouter([{ path: '/', loader, Component: Page }]);
  const view = render(<RouterProvider router={router} />);
  try {
    await act(async () => { await Promise.resolve(); });
    expect(loader).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(loader).toHaveBeenCalledTimes(3);
    await act(async () => { finish(); });
    view.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loader).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    router.dispose();
    vi.useRealTimers();
  }
});
