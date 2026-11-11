const icons = {
  dashboard: {
    src: new URL('../assets/icons/open-aipa.svg', import.meta.url).href,
    label: 'Open AIPA · Dashboard',
  },
  discord: {
    src: new URL('../assets/icons/discord.svg', import.meta.url).href,
    label: 'Discord',
  },
  gmail: {
    src: new URL('../assets/icons/gmail.svg', import.meta.url).href,
    label: 'Gmail',
  },
};
export function ServiceIcon({ service, title }: { service: keyof typeof icons; title?: string }) {
  const icon = icons[service];
  return (
    <img
      className="service-icon"
      src={icon.src}
      alt={icon.label}
      title={title || icon.label}
      width={24}
      height={24}
    />
  );
}
