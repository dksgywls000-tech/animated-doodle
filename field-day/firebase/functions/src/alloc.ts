import { FieldValue, type Firestore } from 'firebase-admin/firestore';

/**
 * 행운권 배정 — 트랜잭션·잠금 없이 '원자적 일괄 생성'으로 처리한다.
 *
 * 한 번의 일괄 쓰기(batch)로 slots/k, checkins/{uid}, tickets/{번호} 세 문서를 '새로 만들기(create)'만 한다.
 * - 세 문서 중 하나라도 이미 있으면 일괄 쓰기 전체가 거절된다 → 반쪽만 저장되는 일이 없다(빈 순번·중복 번호 없음).
 * - slots/k가 이미 있으면 다른 사람이 k번째를 가져간 것 → k+1로 다시 시도.
 * - checkins/{uid}가 이미 있으면 같은 사람이 다른 기기에서 먼저 받은 것 → 그 번호를 돌려준다.
 * - k번째 순번이 300 이하이면 미리 섞어 둔 풀의 k번째 번호, 301부터는 k 그대로.
 * 같은 서버 인스턴스 안에서는 요청을 한 줄로 세워 충돌 자체를 거의 없앤다.
 */
export interface Allocation { ticket: number; seq: number; isNew: boolean }

export class Allocator {
  private chain: Promise<unknown> = Promise.resolve();
  private nextHint = 0;
  private pool: number[] | null = null;
  private gen: number | null = null;

  constructor(private db: Firestore) {}

  /** 풀과 세대(gen)를 읽는다. 행운권 초기화로 세대가 바뀌면 캐시한 풀·순번 힌트를 버린다 */
  private async getPool(): Promise<number[]> {
    const s = await this.db.doc('private/allocation').get();
    if (!s.exists) throw Object.assign(new Error('allocation not initialized'), { code: 'not-initialized' });
    const gen = (s.get('gen') as number | undefined) ?? 0;
    if (this.pool && this.gen === gen) return this.pool;
    this.pool = s.get('pool') as number[];
    this.gen = gen;
    this.nextHint = 0;
    return this.pool;
  }

  async allocate(uid: string): Promise<Allocation> {
    const prior = await this.db.doc(`checkins/${uid}`).get();
    if (prior.exists) return { ticket: prior.get('ticket'), seq: prior.get('seq'), isNew: false };
    const run = this.chain.then(() => this.getPool().then((pool) => this.claim(uid, pool)), () => this.getPool().then((pool) => this.claim(uid, pool)));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async claim(uid: string, pool: number[]): Promise<Allocation> {
    let misses = 0;
    for (let attempt = 0; attempt < 2000; attempt++) {
      if (!this.nextHint || misses % 25 === 24) this.nextHint = (await this.db.collection('slots').count().get()).data().count + 1;
      const k = this.nextHint;
      const ticket = k <= pool.length ? pool[k - 1] : k;
      const b = this.db.batch();
      b.create(this.db.doc(`slots/${k}`), { uid });
      b.create(this.db.doc(`checkins/${uid}`), { seq: k, ticket, at: FieldValue.serverTimestamp() });
      b.create(this.db.doc(`tickets/${ticket}`), { uid, seq: k });
      try {
        await b.commit();
        this.nextHint = k + 1;
        return { ticket, seq: k, isNew: true };
      } catch (e) {
        if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS
        const ci = await this.db.doc(`checkins/${uid}`).get();
        if (ci.exists) return { ticket: ci.get('ticket'), seq: ci.get('seq'), isNew: false };
        misses++;
        this.nextHint = k + 1;
      }
    }
    throw Object.assign(new Error('allocation busy'), { code: 'busy' });
  }
}
