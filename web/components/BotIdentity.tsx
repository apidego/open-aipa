import { useEffect, useState } from 'react';
import { api } from '../api';
import { Brand } from './ui';
export interface BotProfile {
  name: string;
  avatar: string | null;
}
export function useBotProfile() {
  const [profile, setProfile] = useState<BotProfile>({ name: 'Open AIPA', avatar: null });
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api<BotProfile>('/bot-profile')
        .then((value) => {
          if (alive) setProfile(value);
        })
        .catch(() => {});
    void refresh();
    window.addEventListener('bot-profile-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('bot-profile-changed', refresh);
    };
  }, []);
  return profile;
}
export function BotAvatar({ profile, small = false }: { profile: BotProfile; small?: boolean }) {
  return profile.avatar ? (
    <img className={`bot-avatar${small ? ' small' : ''}`} src={profile.avatar} alt="" />
  ) : (
    <span className={`bot-avatar fallback${small ? ' small' : ''}`}>
      <Brand />
    </span>
  );
}
