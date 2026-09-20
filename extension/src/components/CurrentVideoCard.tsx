import { duration } from "@nova/shared";

type Props = {
  title: string;
  channel?: string;
  thumbnail?: string;
  durationSec?: number;
  loading?: boolean;
};

export function CurrentVideoCard({
  title,
  channel,
  thumbnail,
  durationSec,
  loading,
}: Props) {
  if (loading) {
    return (
      <div className="nova-video-card nova-video-card--skeleton" aria-hidden>
        <div className="nova-skeleton nova-video-thumb" />
        <div className="nova-video-meta">
          <div
            className="nova-skeleton nova-skeleton-line"
            style={{ width: "90%" }}
          />
          <div
            className="nova-skeleton nova-skeleton-line"
            style={{ width: "55%" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="nova-video-card">
      {thumbnail ? (
        <img className="nova-video-thumb" src={thumbnail} alt="" />
      ) : (
        <div className="nova-video-thumb nova-video-thumb--empty" />
      )}
      <div className="nova-video-meta">
        <h3 dir="auto">{title}</h3>
        <p>
          {channel || "YouTube"}
          {durationSec ? (
            <span className="nova-duration-badge">{duration(durationSec)}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
