const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
type IP = { size?: number };
const S = ({ size = 24, children }: IP & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...P}>{children}</svg>
);
export const IconPass = (p: IP) => <S {...p}><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M14 5v12" strokeDasharray="2 2" /></S>;
export const IconSchedule = (p: IP) => <S {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></S>;
export const IconMap = (p: IP) => <S {...p}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></S>;
export const IconChat = (p: IP) => <S {...p}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></S>;
export const IconClose = (p: IP) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const IconExpand = (p: IP) => <S {...p}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></S>;
export const IconSend = (p: IP) => <S {...p}><path d="M5 12h12M12 5l7 7-7 7" /></S>;
export const IconChevron = (p: IP) => <S {...p}><path d="m6 9 6 6 6-6" /></S>;
export const IconHelp = (p: IP) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" /></S>;
export const IconSeat = (p: IP) => <S {...p}><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" /></S>;
export const IconShield = (p: IP) => <S {...p}><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z" /><path d="M9 12l2 2 4-4" /></S>;
export const IconPlus = (p: IP) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconMinus = (p: IP) => <S {...p}><path d="M5 12h14" /></S>;
export const IconBell = (p: IP) => <S {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></S>;
export const IconWifiOff = (p: IP) => <S {...p}><path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.3-1.6M2 9.5a15 15 0 0 1 4.5-2.8M22 9.5A15 15 0 0 0 11 5.1M12 20h.01" /></S>;
export const IconLock = (p: IP) => <S {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>;
export const IconCheck = (p: IP) => <S {...p}><path d="m5 12 5 5 9-10" /></S>;
export const IconRefresh = (p: IP) => <S {...p}><path d="M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4" /></S>;
