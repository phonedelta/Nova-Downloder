type Props = {
  title: string;
};

export function LoadingState({ title }: Props) {
  return (
    <div className="nova-loading" aria-busy="true" aria-live="polite">
      <h3>{title}</h3>
      <div className="nova-preview" style={{ padding: 0, border: "none" }}>
        <div className="nova-skeleton nova-skeleton-thumb" />
        <div style={{ flex: 1 }}>
          <div className="nova-skeleton nova-skeleton-line" style={{ width: "90%" }} />
          <div className="nova-skeleton nova-skeleton-line" style={{ width: "60%" }} />
          <div className="nova-skeleton nova-skeleton-line" style={{ width: "40%" }} />
        </div>
      </div>
      <div className="nova-skeleton nova-skeleton-row" />
      <div className="nova-skeleton nova-skeleton-row" />
      <div className="nova-skeleton nova-skeleton-row" />
    </div>
  );
}
