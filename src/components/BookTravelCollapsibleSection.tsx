import type { ReactNode } from 'react';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

interface BookTravelCollapsibleSectionProps {
  title: string;
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelId: string;
  children: ReactNode;
}

export function BookTravelCollapsibleSection({
  title,
  className,
  open,
  onOpenChange,
  panelId,
  children,
}: BookTravelCollapsibleSectionProps) {
  return (
    <section className={className}>
      <h3>
        <button
          type="button"
          className="book-travel-panel-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
        >
          <span>{title}</span>
          {open ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />}
        </button>
      </h3>
      {open ? <div id={panelId}>{children}</div> : null}
    </section>
  );
}
