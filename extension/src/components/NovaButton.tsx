import { Download, X } from "lucide-react";
import type { PointerEventHandler } from "react";

type Props = {
  compact?: boolean;
  open?: boolean;
  labelFull: string;
  labelShort: string;
  activeCount?: number;
  onClick: () => void;
  onDismiss?: () => void;
  dragHandlers?: {
    onPointerDown: PointerEventHandler;
    onPointerMove: PointerEventHandler;
    onPointerUp: PointerEventHandler;
    onPointerCancel: PointerEventHandler;
  };
  dragTitle?: string;
};

export function NovaButton({
  compact,
  open,
  labelFull,
  labelShort,
  activeCount = 0,
  onClick,
  onDismiss,
  dragHandlers,
  dragTitle,
}: Props) {
  const badge =
    activeCount > 0 ? (activeCount > 9 ? "9+" : String(activeCount)) : "";
  return (
    <div className="nova-btn-wrap" title={dragTitle} {...(dragHandlers || {})}>
      <button
        type="button"
        className={`nova-btn${compact ? " nova-btn--compact" : ""}`}
        data-novadownloader-button="true"
        aria-label={
          badge ? `${labelFull} (${activeCount} téléchargements)` : labelFull
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(e) => {
          // Drag handlers open the panel on pointerup to distinguish drag vs click
          if (dragHandlers) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
      >
        <Download size={16} aria-hidden="true" />
        <span className="nova-btn-label-full">{labelFull}</span>
        <span className="nova-btn-label-short">{labelShort}</span>
        {badge ? (
          <span className="nova-btn-badge" aria-hidden>
            {badge}
          </span>
        ) : null}
      </button>
      {onDismiss ? (
        <button
          type="button"
          className="nova-btn-dismiss"
          aria-label="Masquer NovaDownloader"
          title="Masquer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDismiss();
          }}
        >
          <X size={10} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
