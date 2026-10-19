# Netlify + Firebase 배포 안내서 (처음 하는 사람용)

전체 구조는 이렇습니다.

| 역할 | 서비스 | 하는 일 |
|---|---|---|
| 화면(HTML) | **Netlify** | 참가자가 QR로 여는 주소. 화면 파일만 보관 |
| 로그인·행운권·점수 처리 | **Firebase Cloud Functions** | 이름+사번 확인, 행운권 번호 배정, 점수 부여·취소(비밀번호 확인) |
| 데이터 저장·실시간 | **Firebase Firestore** | 명단, 체크인, 점수, 채팅, 공지, 일정 |
| 권한 검사 | **Firestore 보안 규칙** (`firebase/firestore.rules`) | 참가자는 점수·다른 조 채팅·사번을 못 읽게 막음 |

> 걸리는 시간: 처음이면 1~2시간. 아래 순서대로만 하면 됩니다.
> 준비물: 컴퓨터(Windows/Mac), 구글 계정, GitHub 계정, 신용·체크카드(Firebase 요금제 등록용).

---

## 0. 비용

- Cloud Functions를 쓰려면 Firebase **Blaze(종량제) 요금제**가 필요합니다. 카드를 등록하지만 **무료 사용량이 넉넉**합니다.
- 이 행사(약 350명, 하루) 예상: Functions는 무료 범위 안, Firestore 읽기가 무료 한도(하루 5만 건)를 넘을 수 있어 **많아야 수백 원~1~2천 원** 수준입니다.
- 걱정되면 2단계에서 **예산 알림(예: 5,000원)**을 꼭 설정하세요. 행사 후 프로젝트를 삭제하면 더 이상 과금되지 않습니다.

---

## 1. Firebase 프로젝트 만들기 (웹 화면에서)

1. https://console.firebase.google.com 접속 → **프로젝트 추가**
2. 이름: 예) `fieldday-2026` → Google 애널리틱스는 **사용 안 함** → 만들기
3. 왼쪽 아래 **요금제(Spark)** 클릭 → **Blaze로 업그레이드** → 카드 등록
   - 업그레이드 화면에서 **예산 알림**을 5,000원 정도로 설정
4. 왼쪽 메뉴 **빌드 → Firestore Database → 데이터베이스 만들기**
   - 위치: **asia-northeast3 (서울)**
   - **프로덕션 모드**로 시작 (보안 규칙은 4단계에서 자동으로 덮어씀)
5. 왼쪽 메뉴 **빌드 → Authentication → 시작하기** (아무 로그인 방식도 켤 필요 없음. 버튼만 눌러 두면 됨)
6. 프로젝트 개요 옆 ⚙️ **프로젝트 설정 → 일반 → 내 앱 → 웹(</>) 아이콘**
   - 앱 닉네임: `fieldday-web` → 등록 (Firebase 호스팅은 체크하지 않음)
   - 화면에 나오는 `firebaseConfig`에서 아래 4개 값을 메모장에 복사해 둡니다.
     ```
     apiKey: "AIza..."              → VITE_FIREBASE_API_KEY
     authDomain: "xxx.firebaseapp.com" → VITE_FIREBASE_AUTH_DOMAIN
     projectId: "fieldday-2026"     → VITE_FIREBASE_PROJECT_ID
     appId: "1:123:web:abc"         → VITE_FIREBASE_APP_ID
     ```
     이 값들은 화면에 공개되어도 되는 값입니다(권한은 보안 규칙이 지킴).
7. **프로젝트 설정 → 일반**에서 **프로젝트 번호**(숫자)도 메모해 둡니다. 3단계에서 씁니다.

---

## 2. 내 컴퓨터 준비 (한 번만)

1. **Node.js 22 LTS** 설치: https://nodejs.org
2. 터미널(윈도우: PowerShell) 열고:
   ```bash
   npm install -g firebase-tools
   firebase login          # 브라우저가 열리면 1단계와 같은 구글 계정으로 로그인
   ```
3. 받은 zip(또는 GitHub 저장소)을 풀고 `field-day` 폴더로 이동:
   ```bash
   cd field-day
   ```

---

## 3. 서버 부분(Functions·보안 규칙) 올리기

1. `firebase/.firebaserc` 파일을 메모장으로 열어 `demo-fieldday`를 **내 프로젝트 ID**로 바꿉니다.
   ```json
   { "projects": { "default": "fieldday-2026" } }
   ```
2. 터미널에서:
   ```bash
   cd firebase/functions
   npm ci
   cd ..
   firebase deploy
   ```
3. 배포 중에 값을 물어봅니다.
   | 질문 | 입력 |
   |---|---|
   | `SETUP_KEY` | 아무도 모르는 긴 문자열(예: `gaeul-2026-x8k2p9`). **메모해 두세요.** 6단계에서 한 번 씁니다 |
   | `CANCEL_PASSWORD_HASH` | 그냥 Enter → 점수 취소 비밀번호 **1234** 사용. 바꾸려면 아래 "비밀번호 바꾸기" 참고 |
   | `RATE_LIMIT_SECRET` | 아무 긴 문자열(16자 이상) |
   - 처음 배포하면 "API를 켜시겠습니까?" 같은 질문이 나올 수 있습니다 → **Y**
   - 끝나면 `Deploy complete!`가 보입니다. (5~10분)
4. **로그인 토큰 발급 권한 주기 — 꼭 해야 합니다.** 안 하면 로그인할 때 오류가 납니다.
   1. https://console.cloud.google.com/iam-admin/iam 접속 → 상단에서 내 프로젝트 선택
   2. 목록에서 `프로젝트번호-compute@developer.gserviceaccount.com` 줄의 ✏️(수정) 클릭
   3. **다른 역할 추가 → "서비스 계정 토큰 생성자"(Service Account Token Creator)** 선택 → 저장
   4. https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com 에서 **IAM Service Account Credentials API → 사용** 클릭

> 설정값을 나중에 바꾸려면 `firebase/functions/.env.<프로젝트ID>` 파일을 만들어 `SETUP_KEY=...` 형식으로 적고 다시 `firebase deploy --only functions` 하면 됩니다.

---

## 4. 화면(HTML) Netlify에 올리기 — 끌어다 놓기

빌드할 필요 없이 **완성된 화면 폴더**를 올립니다.

1. 받은 `netlify-upload.zip`을 풉니다 → `netlify` 폴더가 생깁니다.
2. 폴더 안의 **`firebase-config.js`**를 메모장으로 열고, 1단계에서 메모한 4개 값을 따옴표 안에 붙여 넣고 저장합니다.
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza....",
     authDomain: "fieldday-2026.firebaseapp.com",
     projectId: "fieldday-2026",
     appId: "1:1234:web:abcd",
   };
   ```
3. https://app.netlify.com/drop 에 접속(Netlify 로그인) → **`netlify` 폴더를 통째로 끌어다 놓기**
4. 1분 안에 `https://무작위이름.netlify.app` 주소가 나옵니다.
   - **Site configuration → Change site name**에서 주소를 바꿀 수 있습니다(예: `fieldday-2026.netlify.app`).
   - 나중에 화면을 바꿔 다시 올릴 때는 그 사이트의 **Deploys** 화면 아래 "drag and drop" 칸에 폴더를 다시 놓으면 같은 주소로 갱신됩니다.

> GitHub 연결로 자동 빌드하고 싶다면: Netlify → Add new site → Import from GitHub → Base directory `field-day`, 환경변수 `VITE_FIREBASE_API_KEY`·`VITE_FIREBASE_AUTH_DOMAIN`·`VITE_FIREBASE_PROJECT_ID`·`VITE_FIREBASE_APP_ID` 4개 입력. (`netlify.toml`에 빌드 설정이 들어 있습니다)

---

## 5. 처음 설정 (owner 등록) + 명단 올리기

1. 브라우저로 `https://내사이트.netlify.app/setup` 접속
2. **설정 키**(3단계 SETUP_KEY)와 **owner의 이름·사번·조**를 입력 → 설정하기
   - owner는 명단에 '관리자'로 되어 있는 분 중 **이 앱을 총괄할 한 명**으로 하세요. 이름·사번을 명단과 **똑같이** 입력합니다(명단을 올려도 owner 권한은 유지됩니다).
   - 이때 일정(버스 12:10·12:35, 17:40 퇴근버스)과 행운권 1~300 무작위 풀이 만들어집니다. 한 번 끝나면 이 화면은 다시 동작하지 않습니다.
3. 첫 화면에서 방금 입력한 **이름·사번**으로 입장
4. 하단 **관리자 화면 → 명단·권한 → CSV 파일 선택** → 받은 **`명단_업로드용.csv`** 선택
   - 미리보기에서 **추가 371명, 오류 0**인지 확인 → '역할 변경' 확인 체크가 나오면 체크 → **명단 반영**
   - 직접 엑셀로 만들 때 머리글은 `사번, 이름, 조, 역할`(또는 `직원명, 사번, 조, 직급`)이면 됩니다. 조는 `1조`~`8조` 또는 `운영진`, 역할/직급은 `관리자`면 관리자, `일반`·`팀장`은 참가자.

### 운영진
명단에서 조가 `운영진`인 16명은 조에 속하지 않는 **운영진**으로 들어갑니다. 행운권은 똑같이 받고, 채팅의 '우리 조' 대신 **운영진 전용 방**을 씁니다. 점수판은 1~8조만 있습니다.

### 인원 추가 (현장에서 명단에 없는 사람)
**관리자 화면 → 체크인 → 인원 추가**에 이름·사번·조를 넣고 **명단에 추가**. 바로 입장할 수 있습니다. 관리자로 추가하는 것은 owner만 가능합니다.

### 행운권 초기화 (리허설 후)
**관리자 화면 → 명단·권한 → 행운권 초기화…** (owner만)
- 확인 문구 `초기화` + 점수 취소 비밀번호(기본 1234)를 입력하면 **모든 행운권 번호·입장 기록을 지우고 1~300을 새로 섞습니다.**
- 점수·채팅·명단은 지워지지 않습니다. 리허설 점수는 '점수 기록'에서 취소하세요.
- 이미 접속해 있던 사람은 앱을 다시 열면 새 번호를 받습니다.
- **행사 당일 참가자 입장이 시작된 뒤에는 절대 누르지 마세요.**

---

## 6. 리허설 체크 (행사 전날까지)

- [ ] 참가자 계정으로 입장 → 조·행운권 번호가 보이는지
- [ ] 같은 계정으로 다른 휴대폰에서 입장 → **번호가 같은지**
- [ ] 관리자 계정 → 점수 부여 → 다른 관리자 휴대폰 점수판에 바로 반영되는지
- [ ] 참가자 화면에는 점수가 안 보이는지
- [ ] 점수 기록 → 취소(비밀번호 1234)
- [ ] 관리자 화면 → **행운권** 탭에서 번호로 사람 조회
- [ ] 전체·우리 조 채팅
- [ ] 리허설에 쓴 점수는 **취소** 처리 (기록은 지워지지 않고 취소로 남습니다)
- [ ] 리허설이 끝나면 **행운권 초기화** → 당일 첫 입장자부터 새 번호
- [ ] 주소로 **QR 제작**

행사 시작 시간이 다가오면 **관리자 화면 → 공지·일정**에서 "일정 확정 공개"를 켜세요(끄면 참가자에게 '초안' 표시).

---

## 비밀번호 바꾸기 (점수 취소)

```bash
cd field-day
npm ci
npm run hash-password      # 새 비밀번호 입력 → SCORE_CANCEL_PASSWORD_HASH='scrypt$...' 출력
```
출력된 `scrypt$...` 부분을 `firebase/functions/.env.<프로젝트ID>` 파일에 `CANCEL_PASSWORD_HASH=scrypt$...`로 넣고 `firebase deploy --only functions`.

---

## 자주 막히는 곳

| 증상 | 해결 |
|---|---|
| 입장하기 누르면 "일시적인 오류" | 3-4단계(서비스 계정 토큰 생성자 권한) 확인 |
| 화면에 "앱 설정이 비어 있습니다" | `firebase-config.js`에 4개 값을 넣었는지 확인 후 폴더를 다시 끌어다 놓기 |
| "행사 설정이 아직 끝나지 않았습니다" | 5단계 `/setup`을 먼저 진행 |
| 관리자 화면에서 "권한이 없습니다" | 명단 CSV에서 그 사람 `role`이 `admin`인지 확인 |
| 배포 시 "requires the Blaze plan" | 1-3단계 요금제 업그레이드 |
| Firestore "index" 오류 | `firebase deploy --only firestore:indexes` 후 몇 분 기다리기 |

---

## 보안상 알아둘 점

- 이름+사번 입장은 행사용 간편 확인이며 강한 본인 인증이 아닙니다.
- 점수·행운권 목록·사번은 보안 규칙으로 참가자에게 막혀 있습니다. 관리자도 사번은 **owner만** 볼 수 있습니다.
- 관리자 권한을 해제하면 그 사람의 다음 조회부터 즉시 차단됩니다(규칙이 매번 명단을 다시 확인). 이미 열린 화면은 자동으로 다시 불러오며 막힙니다.
- 행운권 배정: 로그인 함수는 인스턴스 1개로 고정되어 요청을 한 줄로 처리합니다. 테스트에서 300명 동시 입장이 약 2초에 중복 없이 끝났습니다.
- 행사 후: 관리자 화면 → 명단·권한 → **내보내기**로 CSV를 받아 두고, 필요 없으면 Firebase 프로젝트를 삭제하세요(설정 → 일반 → 프로젝트 삭제).
