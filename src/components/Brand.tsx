type Props = {
  /** true = thème clair → logo clair ; false = thème sombre → logo sombre */
  light?: boolean;
};

export function Brand({ light = false }: Props) {
  return (
    <a className="brand" href="#" aria-label="NovaDownloader, accueil">
      <img
        className="brand-logo"
        src={light ? "/logo-light.png" : "/logo-dark.png"}
        alt="NovaDownloader"
        width={180}
        height={40}
        decoding="async"
      />
    </a>
  );
}
