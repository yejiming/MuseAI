import { useCallback, useReducer } from 'react';

export type FieldUpdater<Value> = Value | ((previous: Value) => Value);
export type StateGroupAction<State extends object> = Partial<State> | ((state: State) => State);

function reducer<State extends object>(state: State, action: StateGroupAction<State>): State {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

export function useStateGroup<State extends object>(initialState: State | (() => State)) {
  const [state, dispatch] = useReducer(
    reducer<State>,
    undefined as unknown as State,
    () => (typeof initialState === 'function' ? (initialState as () => State)() : initialState),
  );

  const patchState = useCallback((action: StateGroupAction<State>) => {
    dispatch(action);
  }, []);

  const setField = useCallback(<Key extends keyof State>(key: Key, value: FieldUpdater<State[Key]>) => {
    dispatch((current) => ({
      ...current,
      [key]: typeof value === 'function'
        ? (value as (previous: State[Key]) => State[Key])(current[key])
        : value,
    }));
  }, []);

  return [state, patchState, setField] as const;
}
