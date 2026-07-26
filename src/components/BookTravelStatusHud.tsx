import { useEffect, useMemo, useRef, useState } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type {
  BookTravelHudDynamicGroup,
  BookTravelHudEntry,
  BookTravelHudModel,
} from '../utils/bookTravelHud';

interface BookTravelStatusHudProps {
  model: BookTravelHudModel;
  restorationKey?: string | null;
}

const NARROW_LAYOUT_QUERY = '(max-width: 1100px)';
const GROUP_PREVIEW_LIMIT = 3;

const getInitialNarrowState = () => (
  typeof window !== 'undefined' && window.matchMedia(NARROW_LAYOUT_QUERY).matches
);

const getEntrySnapshot = (entries: BookTravelHudEntry[]) => {
  const snapshot = new Map<string, string>();
  const visit = (entry: BookTravelHudEntry) => {
    snapshot.set(entry.id, [entry.value, ...(entry.values ?? [])].filter(Boolean).join('|'));
    entry.details?.forEach(visit);
  };
  entries.forEach(visit);
  return snapshot;
};

const getModelSnapshot = (model: BookTravelHudModel) => {
  const entries = [
    ...model.journey,
    ...model.scene,
    ...model.dynamicGroups.flatMap((group) => group.entries),
  ];
  return getEntrySnapshot(entries);
};

const handleKeyboardActivation = (event: React.KeyboardEvent, action: () => void) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
};

function HudEntry({ entry, changedIds }: { entry: BookTravelHudEntry; changedIds: Set<string> }) {
  const hasDetails = Boolean(entry.fullValue || entry.details?.length);
  return (
    <div className={`book-travel-hud-entry ${changedIds.has(entry.id) ? 'is-changed' : ''}`}>
      <div className="book-travel-hud-entry__label">{entry.label}</div>
      <div className="book-travel-hud-entry__content">
        {entry.values && entry.values.length > 0 ? (
          <div className="book-travel-hud-tags">
            {entry.values.map((value, index) => (
              <span key={`${entry.id}-${index}`} className="book-travel-hud-tag">{value}</span>
            ))}
          </div>
        ) : null}
        {entry.value ? <div className="book-travel-hud-entry__value">{entry.value}</div> : null}
        {!entry.value && !entry.values?.length && hasDetails ? (
          <div className="book-travel-hud-entry__hint">包含更多状态</div>
        ) : null}
        {hasDetails ? (
          <details className="book-travel-hud-details">
            <summary>查看详情</summary>
            {entry.fullValue ? <div className="book-travel-hud-details__text">{entry.fullValue}</div> : null}
            {entry.details?.map((detail) => (
              <HudEntry key={detail.id} entry={detail} changedIds={changedIds} />
            ))}
          </details>
        ) : null}
      </div>
    </div>
  );
}

function HudSection({
  title,
  entries,
  changedIds,
}: {
  title: string;
  entries: BookTravelHudEntry[];
  changedIds: Set<string>;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="book-travel-hud-section">
      <h3>{title}</h3>
      <div className="book-travel-hud-section__body">
        {entries.map((entry) => <HudEntry key={entry.id} entry={entry} changedIds={changedIds} />)}
      </div>
    </section>
  );
}

function DynamicGroup({ group, changedIds }: { group: BookTravelHudDynamicGroup; changedIds: Set<string> }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = group.entries.length > GROUP_PREVIEW_LIMIT;
  const visibleEntries = isExpanded ? group.entries : group.entries.slice(0, GROUP_PREVIEW_LIMIT);
  return (
    <section className="book-travel-hud-section">
      <h3>{group.label}</h3>
      <div className="book-travel-hud-section__body">
        {visibleEntries.map((entry) => <HudEntry key={entry.id} entry={entry} changedIds={changedIds} />)}
      </div>
      {canExpand ? (
        <button
          type="button"
          className="book-travel-hud-text-button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? `收起${group.label}` : `展开${group.label}`}
        </button>
      ) : null}
    </section>
  );
}

export function BookTravelStatusHud({ model, restorationKey = null }: BookTravelStatusHudProps) {
  const [isNarrow, setIsNarrow] = useState(getInitialNarrowState);
  const [isOpen, setIsOpen] = useState(() => !getInitialNarrowState());
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [areTurnsExpanded, setAreTurnsExpanded] = useState(false);
  const [changedIds, setChangedIds] = useState<Set<string>>(() => new Set());
  const collapsedButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousSnapshotRef = useRef<Map<string, string> | null>(null);
  const previousSnapshotKeyRef = useRef<string | null>(null);
  const previousRestorationKeyRef = useRef<string | null>(restorationKey);
  const snapshot = useMemo(() => getModelSnapshot(model), [model]);
  const snapshotKey = useMemo(() => JSON.stringify([...snapshot.entries()]), [snapshot]);

  useEffect(() => {
    const media = window.matchMedia(NARROW_LAYOUT_QUERY);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsNarrow(event.matches);
      setIsOpen(!event.matches);
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    const restorationChanged = previousRestorationKeyRef.current !== restorationKey;
    if (!restorationChanged && previousSnapshotKeyRef.current === snapshotKey) return undefined;

    previousSnapshotRef.current = snapshot;
    previousSnapshotKeyRef.current = snapshotKey;
    previousRestorationKeyRef.current = restorationKey;

    if (!previousSnapshot || restorationChanged) {
      if (restorationChanged) setChangedIds(new Set());
      return undefined;
    }

    const nextChangedIds = new Set<string>();
    snapshot.forEach((value, id) => {
      if (previousSnapshot.has(id) && previousSnapshot.get(id) !== value) nextChangedIds.add(id);
    });
    if (nextChangedIds.size === 0) return undefined;
    setChangedIds(nextChangedIds);

    const timer = window.setTimeout(() => setChangedIds(new Set()), 900);
    return () => window.clearTimeout(timer);
  }, [restorationKey, snapshot, snapshotKey]);

  const closePanel = () => {
    setIsOpen(false);
    window.requestAnimationFrame(() => collapsedButtonRef.current?.focus());
  };

  const setPanelOpen = (open: boolean) => setIsOpen(open);

  return (
    <aside
      aria-label="穿书状态"
      className={`book-travel-status-hud is-floating ${isNarrow ? 'is-narrow' : 'is-wide'} ${isOpen ? 'is-open' : 'is-collapsed'}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault();
          closePanel();
        }
      }}
    >
      {!isOpen ? (
        <div className="book-travel-status-hud__compact">
          <button
            ref={collapsedButtonRef}
            type="button"
            className="book-travel-status-hud__compact-button"
            aria-label="展开穿书状态"
            aria-expanded="false"
            onClick={() => setPanelOpen(true)}
            onKeyDown={(event) => handleKeyboardActivation(event, () => setPanelOpen(true))}
          >
            <span className="book-travel-status-hud__compact-copy" aria-hidden="true">
              <span>旅程状态</span>
              <strong>{model.sceneTitle}</strong>
            </span>
            <LeftOutlined aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div id="book-travel-status-hud-panel" className="book-travel-status-hud__panel">
          <header className="book-travel-status-hud__header">
            <div className="book-travel-status-hud__heading">
              <span className="book-travel-status-hud__eyebrow">穿书状态</span>
              <h2>{model.title}</h2>
              <p>{model.sceneTitle}</p>
            </div>
            <button
              type="button"
              className="book-travel-status-hud__collapse"
              aria-label="收起穿书状态"
              aria-expanded="true"
              aria-controls="book-travel-status-hud-panel"
              onClick={() => setPanelOpen(false)}
              onKeyDown={(event) => handleKeyboardActivation(event, () => setPanelOpen(false))}
            >
              <RightOutlined aria-hidden="true" />
            </button>
          </header>

          {model.isCompleted ? <div className="book-travel-status-hud__ended">旅程已结束</div> : null}

          <div className="book-travel-status-hud__content">
            <HudSection title="旅程信息" entries={model.journey} changedIds={changedIds} />
            <HudSection title="当前场景" entries={model.scene} changedIds={changedIds} />
            {model.dynamicGroups.map((group) => (
              <DynamicGroup key={group.id} group={group} changedIds={changedIds} />
            ))}

            <section className="book-travel-hud-section book-travel-hud-recap">
              <h3>剧情回顾</h3>
              {model.recap.summary ? (
                <div className="book-travel-hud-summary">
                  <div className={`book-travel-hud-summary__text ${isSummaryExpanded ? 'is-expanded' : ''}`}>
                    {isSummaryExpanded ? model.recap.summary.fullText : model.recap.summary.preview}
                  </div>
                  {model.recap.summary.isTruncated ? (
                    <button
                      type="button"
                      className="book-travel-hud-text-button"
                      aria-expanded={isSummaryExpanded}
                      onClick={() => setIsSummaryExpanded((value) => !value)}
                    >
                      {isSummaryExpanded ? '收起剧情摘要' : '展开剧情摘要'}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {model.recap.recentTurns.length > 0 ? (
                <div className="book-travel-hud-recent">
                  <button
                    type="button"
                    className="book-travel-hud-text-button"
                    aria-expanded={areTurnsExpanded}
                    onClick={() => setAreTurnsExpanded((value) => !value)}
                  >
                    {areTurnsExpanded ? '收起近期回合' : '展开近期回合'}
                  </button>
                  {areTurnsExpanded ? (
                    <div className="book-travel-hud-recent__list">
                      {model.recap.recentTurns.map((turn) => (
                        <article key={turn.id} className="book-travel-hud-recent__turn">
                          <div className="book-travel-hud-recent__label">{turn.label}</div>
                          <div><strong>你的行动：</strong>{turn.userInput}</div>
                          <div><strong>剧情：</strong>{turn.narrativeOutput}</div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!model.recap.summary && model.recap.recentTurns.length === 0 ? (
                <div className="book-travel-hud-empty">暂无剧情回顾</div>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </aside>
  );
}
