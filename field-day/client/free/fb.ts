import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, onAuthStateChanged, signInAnonymously, browserLocalPersistence, setPersistence, type User } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, memoryLocalCache } from 'firebase/firestore';

const env = import.meta.env;
// 1순위: 사이트 폴더의 firebase-config.js (메모장으로 수정), 2순위: 빌드 환경변수
const runtime = ((window as unknown as { FIREBASE_CONFIG?: Record<string, string> }).FIREBASE_CONFIG ?? {}) as Record<string, string>;
const pick = (k: string, e: unknown) => (runtime[k] && !runtime[k].startsWith('여기에') ? runtime[k] : (e as string) || '');
export const firebaseConfig = {
  apiKey: pick('apiKey', env.VITE_FIREBASE_API_KEY),
  authDomain: pick('authDomain', env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: pick('projectId', env.VITE_FIREBASE_PROJECT_ID),
  appId: pick('appId', env.VITE_FIREBASE_APP_ID),
};
export const configMissing = !firebaseConfig.apiKey || !firebaseConfig.projectId;

export const app = initializeApp(configMissing ? { apiKey: 'missing', projectId: 'missing', appId: 'missing' } : firebaseConfig);
export const auth = getAuth(app);
// 개인정보·관리자 데이터를 기기에 오프라인 캐시로 남기지 않는다
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });

if (env.VITE_USE_EMULATORS === 'true') {
  const host = (env.VITE_EMULATOR_HOST as string) || location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}
void setPersistence(auth, browserLocalPersistence);

let resolveReady: (u: User | null) => void;
export const authReady = new Promise<User | null>((r) => { resolveReady = r; });
onAuthStateChanged(auth, (u) => resolveReady(u));

/** 이 기기의 익명 로그인(없으면 만든다) */
export async function deviceUser(): Promise<User> {
  const u = auth.currentUser ?? (await authReady);
  if (u) return u;
  return (await signInAnonymously(auth)).user;
}
