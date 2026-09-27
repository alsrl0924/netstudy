# 네트워크관리사 2급 기출 학습실

2004년부터 2026년까지의 네트워크관리사 2급 필기 기출을 회차별·오답·클립·랜덤·고빈도 방식으로 학습하는 정적 웹 앱입니다. 기본적으로 브라우저에 학습 기록을 보관하며, Google 로그인을 선택하면 Supabase에도 기록을 동기화합니다.

## 수록 범위

- 91회 시험, 원문 4,550문항
- 원문 PDF의 지문·도표·화면·수식 이미지 350개를 손실 없이 수록
- 의미가 같은 반복 출제를 합친 통합 문항 2,037개
- S 222개, A 298개, B 677개, C 840개
- 빈출 해설 대상 1,197문항: 정답 근거, 네 선택지별 해설, 개념·연결 개념 통합 해설
- C등급 840문항: 교사용 정답과 출제 이력을 빠르게 확인

회차별 문제에서는 실제 출제된 4,550문항을 원문 순서대로 모두 보여 줍니다. 회차별 문제를 제외한 모드에서는 단순 선택지 순서 변경이나 표현 차이를 같은 문항으로 묶고, 선택 범위에서 가장 최근 실제 출제본 한 개를 사용합니다.

## 주요 기능

- 회차별 문제, 오답만 다시, 클립한 문제, 전체 랜덤, 최근 N개년 고빈도
- 최근 3개년(기본), 최근 5개년, 역대 전체와 과목별 필터
- 5·10·25·50·무한 문항 선택
- 학습 모드의 즉시 해설과 시험 모드의 일괄 채점
- 모바일 한 문항씩 이동, PC 시험 모드 다문항 표시
- 문제별 클립과 메모, 누적 오답 횟수, N회 이상 오답 필터
- 오답 노트 목록, 문제 검색·과목·오답 횟수·복습 상태 필터, 개별·전체 재풀이
- 총 풀이 수, 과목별 오답률, 취약 개념, 최근 7일·30일 활동
- 다크 모드, 글자 크기, 진행 중 세션 이어하기, 학습 기록 초기화
- 설치형 웹 앱(PWA)과 오프라인 재접속 지원
- 선택형 Google 로그인과 여러 기기 간 학습 기록 동기화

## 로컬 실행

Node.js 22 이상이 필요합니다.

```powershell
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

정적 배포 파일을 만들려면:

```powershell
npm run build
```

결과는 `out` 폴더에 생성됩니다.

## 문제·해설 데이터 다시 만들기

```powershell
npm run data:build
npm run data:explanations
```

- `data:build`: 상위 폴더의 PDF 추출·중복 검수 결과로 문제은행을 다시 만듭니다.
- `data:explanations`: `tmp/notion-pages`에 저장된 노션 원문 29페이지를 읽어 1,197개 상세 해설과 최종 S/A/B/C 등급을 연결합니다.
- `audit:explanations`: 1,197개 상세 해설의 필수 항목, 금지된 빈 값, 네 선택지 연결 상태를 전수 검사합니다.
- `data:all`: 두 작업을 순서대로 실행합니다.

문제 문장과 선택지는 표시 과정에서 줄바꿈·공백만 정리하며 내용을 축약하거나 바꾸지 않습니다.

PDF 원문과 문제은행을 다시 전수 대조하거나 원문 이미지를 검증하려면 먼저 검수용 Python 패키지를 설치한 뒤 아래 스크립트를 실행합니다.

```powershell
python -m pip install -r scripts/requirements-source-audit.txt
python scripts/audit-source-fidelity.py
python scripts/verify-question-assets.py
```

`audit-source-fidelity.py`는 91개 PDF의 4,550문항을 위치 기준으로 대조하고, `verify-question-assets.py`는 추출된 원문 이미지의 크기와 SHA-256 체크섬을 확인합니다.

## GitHub Pages 배포

`.github/workflows/deploy-pages.yml`이 포함되어 있습니다. GitHub 저장소에 올린 뒤 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 선택하면 `main` 브랜치에 반영될 때 자동으로 정적 사이트를 배포합니다.

프로젝트 사이트(`https://사용자명.github.io/저장소명/`)에서도 동작하도록 빌드 시 경로를 자동 설정합니다.

## 학습 기록

학습 기록은 항상 현재 브라우저의 `localStorage`에 먼저 저장됩니다. 로그인하지 않으면 이 기기에만 남으며, Google 계정으로 로그인하면 `user_progress` 테이블에도 자동 동기화됩니다. 여러 기기의 풀이 이력은 문항별로 합치고, 클립·메모는 마지막으로 수정한 내용을 사용합니다.

Supabase를 처음 설정할 때는 Dashboard의 **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql)을 한 번 실행해야 합니다. **Authentication → URL Configuration → Redirect URLs**에는 로컬 주소와 실제 GitHub Pages 주소를 등록하고, **Authentication → Sign In / Providers → Google**에는 Google Cloud에서 만든 OAuth Client ID와 Secret을 등록합니다.

## 출처

- 교사용 기출 PDF 91회분
- 사용자가 정리한 노션 문제은행 및 상세 해설 페이지

정답은 교사용 기출을 기준으로 하며, 원문 자체에 오류 처리 안내가 있는 문항은 해당 안내를 그대로 유지합니다.
