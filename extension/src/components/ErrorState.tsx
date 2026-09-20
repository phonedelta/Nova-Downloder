type Props = {
  title: string;
  subtitle?: string;
  retryLabel: string;
  onRetry: () => void;
};

export function ErrorState({ title, subtitle, retryLabel, onRetry }: Props) {
  return (
    <div className="nova-error" role="alert">
      <h3>{title}</h3>
      {subtitle ? <p>{subtitle}</p> : null}
      <button type="button" className="nova-action" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}
