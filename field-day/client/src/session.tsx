import { createContext, useContext } from 'react';

export interface Me {
  id: string;
  name: string;
  employeeIdMasked: string;
  teamNumber: number;
  teamName: string;
  seatNote: string;
  ticketNumber: number | null;
  checkedInAt: string | null;
  isStaff: boolean;
  role: 'participant' | 'admin' | 'owner';
  /** 조장 — 자기 조 체크인 현황을 볼 수 있음 */
  isLeader?: boolean;
  csrfToken: string;
  demo: boolean;
}

export const MeCtx = createContext<{ me: Me; refresh: () => Promise<void>; logout: () => Promise<void> }>(null as never);
export const useMe = () => useContext(MeCtx);
