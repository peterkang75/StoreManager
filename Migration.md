# Migration: Replit → Claude Code + Railway

> 시작일: 2026-04-21
> 라이브 체크리스트 — 각 단계 완료 시 `[ ]` → `[x]`로 체크하고 필요 시 메모 추가.
> 전체 설계 원본: `/Users/peter/.claude/plans/whimsical-singing-pillow.md`
> 전제: 아직 실사용자 없음 → 다운타임/컷오버 윈도우 불필요. 커스텀 도메인은 이전 완료 후 별도 작업.

---

## Phase 0 — 백업 (사용자가 Replit에서 수행)

- [x] **0.1** Replit Shell에서 DB 덤프 생성 (2026-04-21, 7.0M)
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl -f snapshot.dump
  ```
- [x] **0.2** 행 수 스냅샷 기록 (2026-04-21, 1.8K)
  ```bash
  psql "$DATABASE_URL" -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1" > rowcount-before.txt
  ```
- [x] **0.3** `snapshot.dump`, `rowcount-before.txt`, `uploads-prod.tar.gz` 로컬 `~/backups/MultiStoreManager/`로 다운로드 (2026-04-21)
- [x] **0.4** Replit `/uploads` 압축 다운로드 (2026-04-21, 32K — VEVO 비자 PDF + Cash Manager TSV)
  ```bash
  tar -czf uploads-prod.tar.gz uploads/
  ```
- [ ] **0.5** Replit Secrets 값을 `.env.local`에 채워넣기 (사용자 언제든 가능)
  - `OPENAI_API_KEY` (supplier invoice 파싱)
  - `CLOUDMAILIN_USER`, `CLOUDMAILIN_PASS` (inbound webhook Basic auth)
  - `SMTP_USER`, `SMTP_PASS` (outbound 메일)
  - DATABASE_URL은 로컬 Homebrew Postgres용으로 이미 설정됨 — Neon 원본은 참고용만
- [x] **0.6** Cloudmailin webhook 설정 기록 (2026-04-21)
  - 수신: `c923c545e2cd747f1899@cloudmailin.net`
  - Forwarding: `https://multi-store-manager.replit.app/api/webhooks/inbound-invoices` (Phase 6b에서 변경 예정)
  - Format: JSON Normalized

---

## Phase 1 — 로컬 클린업 & 개발 환경

### 1a. Homebrew Postgres 16 + 스냅샷 복원 (계획을 Docker → Homebrew로 변경, 2026-04-21)
- [x] **1a.1** `brew install postgresql@16 && brew services start postgresql@16`
- [x] **1a.2** `msm` DB 생성 + pgcrypto 확장 생성
- [x] **1a.3** `pg_restore -d msm --no-owner --no-acl ~/backups/MultiStoreManager/snapshot.dump` (에러 0건)
- [x] **1a.4** 행 수 실측 — Phase 0.2 `n_live_tup`은 ANALYZE 미실행으로 전부 0이었으나 덤프는 실제 데이터 있음. 복원 후 `count(*)` 실측:
  - stores=8, employees=72, payrolls=433, financial_transactions=153
  - cash_sales_details=30, employee_store_assignments=55, supplier_invoices=47, suppliers=7

로컬 접속 URL: `postgresql://peter@localhost:5432/msm`

### 1b. 코드·설정 변경 (Claude 실행)
- [x] **1b.1** `.replit` 삭제
- [x] **1b.2** `replit.md` → `ARCHITECTURE.md` 리네임 + Replit 언급 정리
- [x] **1b.3** `vite.config.ts` — Replit 플러그인 import/블록 제거
- [x] **1b.4** `server/db.ts` — Neon → `pg` + `drizzle-orm/node-postgres`
- [x] **1b.5** `server/index.ts` — `reusePort: true` 제거
- [x] **1b.6** `script/build.ts` — esbuild allowlist 업데이트 (`@neondatabase/serverless`, `ws` 제거 / `pg` 추가)
- [x] **1b.7** `package.json` — deps 추가(`pg`, `@types/pg`) / 제거(`@neondatabase/serverless`, `ws`, `@types/ws`) + devDeps `@replit/*` 3개 제거
- [x] **1b.8** `.gitignore` 하드닝 (`.env*`, `uploads/`, `*.dump`, `snapshot_*` 등)

### 1c. 신규 파일 (Claude 실행)
- [x] **1c.1** `.env.example` 생성
- [x] **1c.2** `.env.local` 생성 (DATABASE_URL + PORT=5001 채움, 시크릿 키 빈 값은 사용자 추가 예정)
- [x] **1c.3** `Dockerfile` 생성 (Phase 4 선행, Node 20 + poppler-utils)

### 1d. 로컬 동작 검증
- [x] **1d.1** `npm install` 성공 (488 packages, Neon/ws/Replit 완전 제거 확인)
- [x] **1d.2** `npm run dev` 에러 없이 기동 (포트 5001 — 5000은 macOS AirPlay 점유)
- [x] **1d.4** `/api/stores` HTTP 200 / 8개 매장, `/api/employees` 72명 확인
- [x] **1d.6** 콘솔 Replit 경고 0건, 시드 스킵 로그 정상
- [ ] **1d.3** `/admin` 로그인 + UI 스모크테스트 — **사용자 직접 브라우저에서** `http://localhost:5001/admin`
- [ ] **1d.5** 파일 업로드 1건 테스트 (OPENAI_API_KEY 채워야 invoice 파싱 검증 가능)

---

## Phase 2 — GitHub 리모트 (사용자 + Claude 공동)

- [ ] **2.1** GitHub private repo 생성 (이름: `MultiStoreManager`) — **사용자 직접**
- [ ] **2.2** `git remote add origin <github-url>` — Claude 실행 가능
- [ ] **2.3** `.gitignore` 하드닝 최종 확인 (커밋 전 `.env*`, `*.dump` 누설 없음)
- [ ] **2.4** `git push -u origin main`
- [ ] **2.5** `replit-agent` 브랜치 처리 결정 (유지/삭제)

---

## Phase 3 — Railway Postgres & 데이터 이관

- [ ] **3.1** Railway 대시보드: 신규 프로젝트 → "Add Postgres" — **사용자 직접**
- [ ] **3.2** Public DATABASE_URL → 로컬 `.env.railway`
- [ ] **3.3** pgcrypto 확장 생성
  ```bash
  psql $RAILWAY_URL -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
  ```
- [ ] **3.4** 스키마 생성
  ```bash
  DATABASE_URL=$RAILWAY_URL npx drizzle-kit push
  ```
- [ ] **3.5** 데이터 복원
  ```bash
  pg_restore --no-owner --no-acl --data-only -d $RAILWAY_URL ~/backups/MultiStoreManager/snapshot.dump
  ```
- [ ] **3.6** 행 수 검증 (테이블별 count Railway vs Docker)
- [ ] **3.7** 시퀀스 리셋 확인
  ```sql
  SELECT setval(pg_get_serial_sequence('<table>','id'), MAX(id)) FROM <table>;
  ```

---

## Phase 4 — Railway 앱 배포

- [ ] **4.1** Railway 대시보드 → "Deploy from GitHub" → 리포지토리 연결 — **사용자 직접**
- [ ] **4.2** Build: Dockerfile 사용 (Phase 1c.3 생성 파일)
- [ ] **4.3** 환경변수 설정
  - `DATABASE_URL` = Railway Postgres **private** URL
  - `SESSION_SECRET`
  - `OPENAI_API_KEY`
  - `CLOUDMAILIN_*` (활성 시)
  - `SMTP_*` (활성 시)
  - `PORT=5000`
  - `NODE_ENV=production`
- [ ] **4.4** Persistent Volume 추가 (mount: `/app/uploads`, size: 1GB)
- [ ] **4.5** 첫 빌드 성공 + 헬스체크 통과
- [ ] **4.6** Railway 서브도메인(`*.up.railway.app`) 접속 스모크테스트
  - 로그인 OK
  - 매장·직원 조회 OK

---

## Phase 5 — uploads 이관

**일회성 관리자 엔드포인트 방식:**
- [ ] **5.1** 임시 브랜치 생성 (`chore/migrate-uploads`)
- [ ] **5.2** `POST /admin/migrate-uploads` 라우트 추가 (관리자 인증 + multipart → `/app/uploads`)
- [ ] **5.3** Railway 배포 (브랜치)
- [ ] **5.4** 로컬 스크립트로 `uploads-prod.tar.gz` 해제 후 업로드 전송
- [ ] **5.5** 파일 수·체크섬 대조
- [ ] **5.6** 엔드포인트 제거 커밋 + 메인 브랜치 병합 후 재배포
- [ ] **5.7** 운영 화면에서 기존 PDF 열기·다운로드 정상 확인

---

## Phase 6 — 통합 스모크테스트 & Cloudmailin 전환

### 6a. 기능 점검
- [ ] **6a.1** 타임시트 제출/승인
- [ ] **6a.2** 급여 계산 + `CASH_WAGE` 트랜잭션 자동 생성
- [ ] **6a.3** 일일 마감 입력 + 현금 정산
- [ ] **6a.4** 공급업체 인보이스 PDF 업로드 + OpenAI 파싱
- [ ] **6a.5** 직원 포털 PIN 로그인 (`/m/portal`)
- [ ] **6a.6** 로스터 빌더 동작

### 6b. Cloudmailin (활성 시)
- [ ] **6b.1** 관리 콘솔 webhook URL을 Railway URL로 변경 — **사용자 직접**
- [ ] **6b.2** 테스트 메일 inbound 파싱 확인

### 6c. 관찰
- [ ] **6c.1** Railway 로그 1~3일 관찰 (에러 없음)
- [ ] **6c.2** Volume 사용량 합리적 범위

---

## Phase 7 — Replit 정리 (1~2주 관찰 후)

- [ ] **7.1** Replit 프로젝트 Archive (즉시 삭제 X)
- [ ] **7.2** Replit 프로비저닝 Neon DB 삭제
- [ ] **7.3** 로컬 스냅샷 파일 30일 보관 후 정리
- [ ] **7.4** 리포지토리 final grep: `replit`, `REPL_ID`, `@replit/` 0건

---

## Phase 8 (범위 외, 참고) — 커스텀 도메인

- [ ] Railway 커스텀 도메인 연결
- [ ] Cloudmailin webhook URL 도메인으로 재변경
- [ ] PWA manifest `start_url` 업데이트 (`plan.md §6.3.9`)

---

## 메모 / 이슈 로그

_필요 시 여기에 단계별 메모·문제·결정사항 기록_

