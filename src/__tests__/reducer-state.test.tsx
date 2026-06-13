import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStateGroup } from '../utils/reducerState';

const ReducerStateHarness = () => {
  const [state, patchState, setField] = useStateGroup({
    count: 0,
    label: 'idle',
  });

  return (
    <div>
      <span data-testid="count">{state.count}</span>
      <span data-testid="label">{state.label}</span>
      <button type="button" onClick={() => patchState({ label: 'patched' })}>
        patch
      </button>
      <button type="button" onClick={() => setField('count', (count) => count + 1)}>
        increment
      </button>
    </div>
  );
};

describe('useStateGroup', () => {
  it('supports object patches and field updater functions', () => {
    render(<ReducerStateHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'patch' }));
    fireEvent.click(screen.getByRole('button', { name: 'increment' }));

    expect(screen.getByTestId('label')).toHaveTextContent('patched');
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });
});
