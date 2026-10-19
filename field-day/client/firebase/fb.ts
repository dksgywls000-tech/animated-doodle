import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, onAuthStateChanged, inMemoryPersistence, browserLocalPersistence, setPersistence, type User } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, memoryLocalCache } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string,
  appId: env.VITE_FIREBASE_APP_ID as string,
};
export const configMissing = !firebaseConfig.apiKey || !firebaseConfig.projectId;

export const app = initializeApp(configMissing ? { apiKey: 'missing', projectId: 'missing', appId: 'missing' } : firebaseConfig);
export const auth = getAuth(app);
// 개인정보·관리자 데이터를 기기에 오프라인 캐시로 남기지 않는다(메모리 캐시만)
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export const fns = getFunctions(app, 'asia-northeast3');

if (env.VITE_USE_EMULATORS === 'true') {
  const host = (env.VITE_EMULATOR_HOST as string) || location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(fns, host, 5001);
}

// 로그인 유지: 기본은 이 기기에 유지. 공용 기기라면 VITE_AUTH_SESSION_ONLY=true
void setPersistence(auth, env.VITE_AUTH_SESSION_ONLY === 'true' ? inMemoryPersistence : browserLocalPersistence);

let resolveReady: (u: User | null) => void;
export const authReady = new Promise<User | null>((r) => { resolveReady = r; });
onAuthStateChanged(auth, (u) => resolveReady(u));
