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

## Phase 2 — GitHub 리모트 ✅ (2026-04-21)

- [x] **2.1** GitHub private repo 생성 — `https://github.com/peterkang75/StoreManager`
- [x] **2.2** `git remote add origin https://github.com/peterkang75/StoreManager.git`
- [x] **2.3** `.gitignore` 검증 (`.env.local`, `*.dump`, `uploads/` 전부 무시 확인됨)
- [x] **2.4** `git push -u origin main` (commit `fd79b90` — migration 일괄)
- [ ] **2.5** `replit-agent` 브랜치 처리 결정 (나중에)

---

## Phase 3 — Railway Postgres & 데이터 이관 ✅ (2026-04-21)

- [x] **3.1** Railway 대시보드: 신규 프로젝트 → "Add Postgres" (Postgres 18.3 프로비저닝)
- [x] **3.2** Public DATABASE_URL 확보 (`shinkansen.proxy.rlwy.net:10884`)
- [x] **3.3** pgcrypto 확장 생성 (DROP SCHEMA public CASCADE 후 재생성 단계에서 포함)
- [x] **3.4** 스키마 생성 — `npx drizzle-kit push` 완료 (drizzle-kit이 대화형 프롬프트 요구 → `echo "y"` 파이프)
- [x] **3.5** 데이터 복원 — 2회 재작업 발생:
  1. 1차: FK 제약 13건 실패 → `--disable-triggers -1` (단일 트랜잭션 + session_replication_role=replica)로 성공, 행 수는 맞았으나…
  2. **잘못된 DB였음**: Phase 0에서 Replit Shell `$DATABASE_URL`로 dump했는데 이건 **개발/스테이징 DB**였고, 프로덕션(`multi-store-manager.replit.app`)은 별도 Neon DB(`ep-steep-sunset-aedscouf`) 사용 중. 화면에서 "지난주 payroll 안 보임" 증상으로 발각
  3. 2차: 프로덕션 DATABASE_URL(Replit Deployment Secrets에서 확보)로 새 dump(28MB) → Railway DROP SCHEMA + drizzle-kit push + `pg_restore --disable-triggers -1 --schema=public` (Replit 전용 `_system` 스키마 제외) → 성공
  ```bash
  pg_restore --no-owner --no-acl --data-only --disable-triggers -1 --schema=public -d "$DATABASE_URL" ~/backups/MultiStoreManager/snapshot.dump
  ```
- [x] **3.6** 행 수 검증 — Railway = 로컬 = 프로덕션 100% 일치 (최종값):
  - stores=8, employees=72, payrolls=470, financial_transactions=173
  - cash_sales_details=80, employee_store_assignments=56, suppliers=15, supplier_invoices=214
  - 최신 payroll period: `2026-03-23 ~ 2026-04-05` (created 2026-04-07)
- [x] **3.7** 시퀀스 리셋 — Railway · 로컬 양쪽 모두 `store_trading_hours` → 5. 나머지 4개 serial 테이블은 비어 있음(1). 대부분 테이블은 UUID(`gen_random_uuid()`) 사용.

---

## Phase 4 — Railway 앱 배포 ✅ (2026-04-21)

- [x] **4.1** Railway 대시보드 → "Deploy from GitHub" → 리포지토리 연결
- [x] **4.2** Build: Dockerfile 사용 (Phase 1c.3 생성 파일)
- [x] **4.3** 환경변수 설정 완료
  - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway 템플릿 참조 — 초기에 `.env.example`의 샘플 `localhost:5433` URL을 실수로 복사했다가 재설정, 그 후 trailing whitespace로 `"railway  "` 파싱 오류 발생 → 공백 제거 후 정상)
  - `SESSION_SECRET`, `OPENAI_API_KEY`, `CLOUDMAILIN_*`, `SMTP_*`, `PORT=5000`, `NODE_ENV=production`
- [x] **4.4** Persistent Volume 추가 — mount path `/app/uploads` (Railway 신규 UI에서는 size 입력 필드가 없어 자동 할당)
- [x] **4.5** 첫 빌드 성공 + 컨테이너 기동
- [x] **4.6** Railway 서브도메인 접속 스모크테스트 — 로그인 OK, 매장 8개·직원 72명 조회 OK, 최신 payroll period 2026-03-23~04-05 표시 확인

---

## Phase 5 — uploads 이관 ⏭️ SKIPPED (2026-04-21)

**스킵 근거:** DB 스키마 전수조사 결과, Replit `/uploads` 폴더에는 **DB 레코드와 연결된 운영 파일이 0건**.
- `supplier_invoices.pdf_url` 214건 전부 NULL — Cloudmailin → OpenAI 파싱 후 PDF 폐기 설계
- `employees.passport_url` / `selfie_url` 값 있는 1건은 외부 Fillout S3 URL (Replit FS 아님)
- `employees.vevo_url`, `employee_documents.file_path` 모두 NULL/empty
- `uploads-prod.tar.gz` 8개 파일(32KB)은 VEVO Angy TAMANG 테스트 업로드 잔재 + Cash Manager TSV 1개, **DB 어느 행에도 참조되지 않음**

Railway Volume(`/app/uploads`)은 신규 업로드 수용용으로만 비어 있는 상태로 운영. 로컬 백업 `~/backups/MultiStoreManager/uploads-prod.tar.gz`는 계속 보관.

---

## Phase 6 — 통합 스모크테스트 & Cloudmailin 전환

### 6a. 기능 점검
- [x] **6a.1** 타임시트 제출/승인 — Pending Approval → Approve → shift_timesheets.status=APPROVED DB write 정상 (Railway 실시간 검증: Aiden 04-06 shift `updated_at=2026-04-21 08:32:41`)
- [x] **6a.2** 급여 계산 로직 정상 — 클라이언트 `approvedHoursMap` 필터(`storeId` + `date` 범위 + `status='APPROVED'`)로 Hours 합산. Cycle 0(03-23~04-05) 선택 시 Aiden 2.27h, Cycle 1(04-06~04-19) 선택 시 16h 정상 출력.
  - **사용자 혼동 포인트**: 새로 Approve한 shift의 payroll 행이 자동 생성되지 않고, 해당 cycle로 Payroll 화면을 수동 이동해야 Hours가 보임. 이건 기존 UX 동작이지 회귀 아님.
- [ ] **6a.3** 일일 마감 입력 + 현금 정산 — 미검증 (옵션)
- [ ] **6a.4** 공급업체 인보이스 PDF 업로드 + OpenAI 파싱 — 미검증 (옵션)
- [ ] **6a.5** 직원 포털 PIN 로그인 (`/m/portal`) — 미검증 (옵션)
- [ ] **6a.6** 로스터 빌더 동작 — 로스터 생성은 확인 완료 (Pending Approval까지 정상 플로우)

### 6b. Cloudmailin (활성 시) — 사용자 직접 수행

**Railway 서브도메인**: `storemanager-production-103d.up.railway.app` (2026-04-21 확정)

**변경 대상**: Cloudmailin Admin Console → Addresses → `c923c545e2cd747f1899@cloudmailin.net` → Forwarding URL

- 기존: `https://sushme:Kjhcloudmainin1411!@multi-store-manager.replit.app/api/webhooks/inbound-invoices`
- 신규: `https://sushme:Kjhcloudmainin1411!@storemanager-production-103d.up.railway.app/api/webhooks/inbound-invoices`
- URL 앞부분 `user:pass@` 형식은 기존 Cloudmailin 설정 방식과 동일 — 호스트만 Railway 서브도메인으로 교체.
- Railway 환경변수 `CLOUDMAILIN_USER=sushme`, `CLOUDMAILIN_PASS=Kjhcloudmainin1411!` 이미 세팅됨.
- 2026-04-21 라이브 검증: `curl POST .../inbound-invoices` → `HTTP 200` (Basic Auth 통과 확인).
- Format: JSON Normalized 유지

- [x] **6b.1** Railway 서브도메인 URL 확정 (2026-04-21) — `storemanager-production-103d.up.railway.app`
- [x] **6b.2** Cloudmailin 관리 콘솔에서 Forwarding URL 교체 (2026-04-21)
- [x] **6b.3** 테스트 메일 정상 수신 확인 (2026-04-21) — 사용자 육안 검증

### 6c. 관찰 (2026-04-21 시작 → 2026-04-24 기준 통과 판단)
- [ ] **6c.1** Railway 로그 1~3일 관찰 — 5xx 에러·DB 커넥션 실패·Cloudmailin 재시도 폭주 없는지
- [ ] **6c.2** Volume 사용량 합리적 범위 — 신규 업로드 수용 정상
- [ ] **6c.3** Cloudmailin inbound 실제 메일 1~2건 이상 자동 파싱 → `supplier_invoices` row 누적 확인

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

### 2026-04-21 Phase 6a 결과
- Phase 6a.1, 6a.2 완료 — 타임시트 Approve + Payroll 계산 이관 회귀 없음.
- **UX 관찰(이관 무관)**: Approve 후 Payroll 화면이 현재 cycle로만 로드되어, 과거 cycle 속한 shift는 수동 이동 필요. `plan.md §6.0 Active Issues`에 별도 기록.
- 6a.3~6a.6은 옵션 — 사용자 일상 사용 중 발견 시 그때 처리.

### 2026-04-21 Phase 6b 완료
- Railway 서브도메인 확정: `storemanager-production-103d.up.railway.app`
- Cloudmailin Forwarding URL 교체 → 테스트 메일 정상 수신 확인.
- 자격증명 형식은 기존 방식 유지(`https://user:pass@host/...`) — Railway 환경변수 `CLOUDMAILIN_USER/PASS`와 일치.

