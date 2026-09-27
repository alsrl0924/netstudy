"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudOff,
  Clock3,
  Flame,
  History,
  Home,
  ListChecks,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Network,
  Play,
  RotateCcw,
  RefreshCw,
  Shuffle,
  Sun,
  Target,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCloudProgress } from "@/hooks/use-cloud-progress";
import {
  cleanDisplayText,
  EMPTY_STORE,
  emptyQuestionProgress,
  Explanation,
  ExplanationMap,
  formatExam,
  loadProgress,
  PracticeMode,
  ProgressStore,
  Question,
  QuestionBank,
  QuestionCount,
  recordAttempt,
  saveProgress,
  SESSION_KEY,
  SessionOptions,
  SessionType,
  shuffled,
  STORAGE_KEY,
  YearRange,
  yearStart,
} from "@/lib/study";

type View = "home" | "session" | "profile";
type ActiveSession = {
  options: SessionOptions;
  questionIds: string[];
  index: number;
  answers: Record<string, number>;
  gradedIds: string[];
  submitted: boolean;
};

const modeMeta: Array<{
  id: PracticeMode;
  label: string;
  description: string;
  icon: typeof History;
}> = [
  { id: "round", label: "회차별 문제", description: "실제 시험 순서와 원문 그대로", icon: History },
  { id: "wrong", label: "오답만 다시", description: "틀린 횟수를 기준으로 집중 복습", icon: RotateCcw },
  { id: "clips", label: "클립한 문제", description: "헷갈려서 저장한 문제만 모아서", icon: Bookmark },
  { id: "random", label: "전체 문제 랜덤", description: "연도와 과목을 골라 무작위 출제", icon: Shuffle },
  { id: "frequent", label: "고빈도 문제", description: "선택한 기간에 자주 나온 순서", icon: Flame },
];

const defaultOptions: SessionOptions = {
  mode: "random",
  type: "study",
  yearRange: "3",
  subject: "all",
  count: "10",
  examDate: "",
  minimumWrong: 1,
};

function navCount(mode: PracticeMode, bank: QuestionBank, progress: ProgressStore) {
  if (mode === "round") return `${bank.meta.examCount}회`;
  if (mode === "wrong") {
    return `${Object.values(progress.questions).filter((item) => item.wrong > 0).length}문제`;
  }
  if (mode === "clips") {
    return `${Object.values(progress.questions).filter((item) => item.clipped).length}문제`;
  }
  if (mode === "frequent") {
    return `${bank.clusters.filter((item) => item.totalCount >= 2).length}문제`;
  }
  return `${bank.meta.uniqueQuestionCount.toLocaleString()}문제`;
}

export default function HomePage() {
  const [bank, setBank] = useState<QuestionBank | null>(null);
  const [explanations, setExplanations] = useState<ExplanationMap>({});
  const [progress, setProgress] = useState<ProgressStore>(EMPTY_STORE);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("home");
  const [options, setOptions] = useState<SessionOptions>(defaultOptions);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const cloud = useCloudProgress(hydrated, progress, setProgress);

  useEffect(() => {
    Promise.all([
      fetch("./data/question-bank.json", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("문제 데이터를 불러오지 못했습니다.");
        return response.json() as Promise<QuestionBank>;
      }),
      fetch("./data/explanations.json", { cache: "no-store" }).then((response) => {
        if (!response.ok) return {};
        return response.json() as Promise<ExplanationMap>;
      }),
    ])
      .then(([questionBank, explanationData]) => {
        setBank(questionBank);
        setExplanations(explanationData);
        setOptions((current) => ({
          ...current,
          examDate: questionBank.exams.at(-1)?.date ?? "",
        }));
      })
      .catch((error: Error) => setLoadError(error.message));

    Promise.resolve().then(() => {
      setProgress(loadProgress());
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (hydrated) saveProgress(progress);
  }, [hydrated, progress]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    if (active) window.localStorage.setItem(SESSION_KEY, JSON.stringify(active));
    else window.localStorage.removeItem(SESSION_KEY);
  }, [active, hydrated]);

  const dark = progress.preferences.dark;
  const fontScale = progress.preferences.fontScale;

  useEffect(() => {
    document.documentElement.dataset.fontScale = fontScale;
  }, [fontScale]);

  function updatePreference(update: Partial<ProgressStore["preferences"]>) {
    setProgress((current) => ({
      ...current,
      preferences: { ...current.preferences, ...update },
      preferencesUpdatedAt: new Date().toISOString(),
    }));
  }

  function buildPool(nextOptions: SessionOptions) {
    if (!bank) return [] as Question[];
    const questionById = new Map(bank.questions.map((question) => [question.id, question]));
    if (nextOptions.mode === "round") {
      const exam = bank.exams.find((item) => item.date === nextOptions.examDate);
      return (exam?.questionIds ?? [])
        .map((id) => questionById.get(id))
        .filter((question): question is Question => Boolean(question));
    }

    const startYear = yearStart(bank.meta.latestYear, nextOptions.yearRange);
    const eligibleClusters = bank.clusters
      .map((cluster) => {
        const occurrences = cluster.occurrenceIds
          .map((id) => questionById.get(id))
          .filter((question): question is Question => Boolean(question))
          .filter(
            (question) =>
              question.year >= startYear &&
              (nextOptions.subject === "all" || question.subject === nextOptions.subject),
          );
        if (!occurrences.length) return null;
        const latest = [...occurrences].sort(
          (left, right) =>
            right.examDate.localeCompare(left.examDate) || right.number - left.number,
        )[0];
        return { cluster, latest, count: occurrences.length };
      })
      .filter(
        (
          item,
        ): item is {
          cluster: QuestionBank["clusters"][number];
          latest: Question;
          count: number;
        } => Boolean(item),
      );

    let candidates = eligibleClusters;
    if (nextOptions.mode === "wrong") {
      candidates = candidates
        .filter(
          ({ cluster }) =>
            (progress.questions[cluster.id]?.wrong ?? 0) >= nextOptions.minimumWrong,
        )
        .sort(
          (left, right) =>
            (progress.questions[right.cluster.id]?.wrong ?? 0) -
            (progress.questions[left.cluster.id]?.wrong ?? 0),
        );
    } else if (nextOptions.mode === "clips") {
      candidates = candidates.filter(
        ({ cluster }) => progress.questions[cluster.id]?.clipped,
      );
    } else if (nextOptions.mode === "frequent") {
      candidates = candidates
        .filter(({ count }) => count >= 2)
        .sort(
          (left, right) =>
            right.count - left.count ||
            right.cluster.totalCount - left.cluster.totalCount ||
            right.latest.examDate.localeCompare(left.latest.examDate),
        );
    } else {
      candidates = shuffled(candidates);
    }

    if (nextOptions.mode === "clips") candidates = shuffled(candidates);
    const desired = nextOptions.count === "all" ? candidates.length : Number(nextOptions.count);
    return candidates.slice(0, desired).map((item) => item.latest);
  }

  function startSession(nextOptions = options) {
    const pool = buildPool(nextOptions);
    if (!pool.length) return false;
    setActive({
      options: nextOptions,
      questionIds: pool.map((question) => question.id),
      index: 0,
      answers: {},
      gradedIds: [],
      submitted: false,
    });
    setView("session");
    window.scrollTo({ top: 0 });
    return true;
  }

  function continueSavedSession() {
    if (typeof window === "undefined") return false;
    try {
      const saved = window.localStorage.getItem(SESSION_KEY);
      if (!saved) return false;
      setActive(JSON.parse(saved) as ActiveSession);
      setView("session");
      return true;
    } catch {
      return false;
    }
  }

  if (loadError) {
    return (
      <CenteredState icon={AlertTriangle} title="문제 데이터를 열 수 없습니다" description={loadError}>
        <Button onClick={() => window.location.reload()}>다시 불러오기</Button>
      </CenteredState>
    );
  }

  if (!bank || !hydrated) {
    return (
      <CenteredState
        icon={LoaderCircle}
        spin
        title="문제은행을 준비하고 있습니다"
        description="91회분 기출과 학습 기록을 불러오는 중입니다."
      />
    );
  }

  return (
    <main className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground">
        <AppHeader
          view={view}
          dark={dark}
          fontScale={fontScale}
          cloud={cloud}
          onView={setView}
          onToggleDark={() => updatePreference({ dark: !dark })}
          onFontScale={(value) => updatePreference({ fontScale: value })}
        />

        {view === "home" && (
          <HomeView
            bank={bank}
            progress={progress}
            options={options}
            setOptions={setOptions}
            buildPool={buildPool}
            startSession={startSession}
            continueSavedSession={continueSavedSession}
          />
        )}

        {view === "session" && active && (
          <SessionView
            bank={bank}
            explanations={explanations}
            active={active}
            setActive={setActive}
            progress={progress}
            setProgress={setProgress}
            onExit={() => {
              setView("home");
              setActive(null);
            }}
          />
        )}

        {view === "profile" && (
          <ProfileView
            bank={bank}
            progress={progress}
            cloud={cloud}
            onReset={async () => {
              const cleared = await cloud.clearRemote();
              if (!cleared) return;
              setProgress({
                ...EMPTY_STORE,
                preferences: progress.preferences,
                preferencesUpdatedAt: new Date().toISOString(),
              });
              window.localStorage.removeItem(STORAGE_KEY);
              window.localStorage.removeItem(SESSION_KEY);
              setActive(null);
            }}
          />
        )}
      </div>
    </main>
  );
}

function AppHeader({
  view,
  dark,
  fontScale,
  cloud,
  onView,
  onToggleDark,
  onFontScale,
}: {
  view: View;
  dark: boolean;
  fontScale: ProgressStore["preferences"]["fontScale"];
  cloud: ReturnType<typeof useCloudProgress>;
  onView: (view: View) => void;
  onToggleDark: () => void;
  onFontScale: (value: ProgressStore["preferences"]["fontScale"]) => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const accountEmail = cloud.user?.email ?? "";
  const accountInitial = accountEmail.slice(0, 1).toUpperCase() || "U";
  const cloudStatus =
    cloud.status === "syncing" || cloud.status === "connecting"
      ? "동기화 중"
      : cloud.status === "synced"
        ? "동기화 완료"
        : cloud.status === "offline"
          ? "오프라인 · 기기에 저장 중"
          : cloud.status === "error"
            ? "동기화 확인 필요"
            : "게스트 모드";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-2 px-3 sm:gap-3 sm:px-7">
          <button className="flex min-w-0 items-center gap-3" onClick={() => onView("home")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
              <Network className="size-5" strokeWidth={2.2} />
            </span>
            <span className="hidden min-w-0 text-left min-[560px]:block">
              <span className="block truncate text-[0.9375rem] font-extrabold tracking-[-0.02em]">
                네트워크관리사 2급
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">기출 학습실</span>
            </span>
          </button>

          <nav className="ml-5 hidden items-center gap-1 md:flex" aria-label="주요 메뉴">
            <Button
              variant={view === "home" ? "secondary" : "ghost"}
              className="gap-2 rounded-xl"
              onClick={() => onView("home")}
            >
              <Home className="size-4" /> 문제 풀이
            </Button>
            <Button
              variant={view === "profile" ? "secondary" : "ghost"}
              className="gap-2 rounded-xl"
              onClick={() => onView("profile")}
            >
              <BarChart3 className="size-4" /> 나의 학습
            </Button>
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
            <NativeSelect
              value={fontScale}
              onChange={(event) =>
                onFontScale(event.target.value as ProgressStore["preferences"]["fontScale"])
              }
              aria-label="글자 크기"
              className="w-[78px] rounded-xl text-xs sm:w-[116px]"
            >
              <NativeSelectOption value="normal">보통</NativeSelectOption>
              <NativeSelectOption value="large">크게</NativeSelectOption>
              <NativeSelectOption value="xlarge">매우 크게</NativeSelectOption>
            </NativeSelect>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "밝은 화면으로 전환" : "어두운 화면으로 전환"}
              onClick={onToggleDark}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            {cloud.configured && (
              <Button
                variant={cloud.user ? "secondary" : "default"}
                className="min-w-0 gap-2 rounded-xl px-2.5 sm:px-3"
                onClick={() => setAccountOpen(true)}
                aria-label={cloud.user ? `${accountEmail} 계정 열기` : "로그인"}
              >
                {cloud.user ? (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[0.6875rem] font-black text-primary-foreground">
                    {accountInitial}
                  </span>
                ) : (
                  <UserRound className="size-4" />
                )}
                <span className="truncate text-xs font-extrabold sm:text-sm">
                  {cloud.user ? (
                    <>
                      <span className="lg:hidden">계정</span>
                      <span className="hidden max-w-36 truncate lg:block">{accountEmail}</span>
                    </>
                  ) : (
                    "로그인"
                  )}
                </span>
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              className="rounded-xl md:hidden"
              aria-label={view === "profile" ? "문제 풀이" : "나의 학습"}
              onClick={() => onView(view === "profile" ? "home" : "profile")}
            >
              {view === "profile" ? <Home className="size-4" /> : <BarChart3 className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          {cloud.user ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                    {accountInitial}
                  </span>
                  계정
                </DialogTitle>
                <DialogDescription>{accountEmail}</DialogDescription>
              </DialogHeader>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                <div className="flex items-center gap-3">
                  {cloud.status === "offline" || cloud.status === "error" ? (
                    <CloudOff className="size-5 text-muted-foreground" />
                  ) : (
                    <Cloud className="size-5 text-emerald-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold">{cloudStatus}</p>
                    <p className="text-xs text-muted-foreground">
                      {cloud.lastSyncedAt
                        ? `마지막 저장 ${new Date(cloud.lastSyncedAt).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : "학습 기록을 클라우드에 연결하고 있습니다."}
                    </p>
                  </div>
                </div>
                {cloud.message && (
                  <p className="mt-3 text-sm text-destructive">{cloud.message}</p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  className="gap-2 rounded-xl"
                  disabled={cloud.status === "syncing"}
                  onClick={() => void cloud.syncNow()}
                >
                  <RefreshCw
                    className={`size-4 ${cloud.status === "syncing" ? "animate-spin" : ""}`}
                  />
                  지금 동기화
                </Button>
                <Button
                  variant="ghost"
                  className="gap-2 rounded-xl"
                  onClick={async () => {
                    await cloud.signOut();
                    setAccountOpen(false);
                  }}
                >
                  <LogOut className="size-4" /> 로그아웃
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div>
              <DialogHeader>
                <DialogTitle>로그인</DialogTitle>
                <DialogDescription>
                  Google 계정으로 로그인하면 현재 기기의 학습 기록이 계정에 연결됩니다.
                </DialogDescription>
              </DialogHeader>
              {cloud.message && (
                <p className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  {cloud.message}
                </p>
              )}
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full gap-3 rounded-xl bg-white font-extrabold text-slate-800 hover:bg-slate-50 dark:bg-white dark:text-slate-800 dark:hover:bg-slate-100"
                  disabled={googleConnecting}
                  onClick={async () => {
                    if (googleConnecting) return;
                    setGoogleConnecting(true);
                    const redirected = await cloud.signInWithGoogle();
                    if (!redirected) setGoogleConnecting(false);
                  }}
                >
                  {googleConnecting ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  Google로 계속하기
                </Button>
              </DialogFooter>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                로그인하지 않아도 게스트로 모든 문제를 풀 수 있습니다.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0">
      <path
        fill="#4285F4"
        d="M21.35 12.2c0-.7-.06-1.22-.2-1.76H12v3.48h5.37a4.58 4.58 0 0 1-1.99 2.92l-.02.12 2.89 2.24.2.02c1.84-1.7 2.9-4.2 2.9-7.02Z"
      />
      <path
        fill="#34A853"
        d="M12 21.7c2.62 0 4.82-.86 6.43-2.48l-3.07-2.38c-.82.55-1.93.94-3.36.94a5.84 5.84 0 0 1-5.52-4.03l-.11.01-3 2.32-.04.1A9.7 9.7 0 0 0 12 21.7Z"
      />
      <path
        fill="#FBBC05"
        d="M6.48 13.75A5.96 5.96 0 0 1 6.15 12c0-.61.11-1.2.32-1.75v-.12L3.43 7.77l-.1.05A9.7 9.7 0 0 0 2.3 12c0 1.5.36 2.92 1.03 4.18l3.15-2.43Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.22c1.82 0 3.05.79 3.74 1.43l2.75-2.68C16.8 3.4 14.62 2.3 12 2.3a9.7 9.7 0 0 0-8.67 5.52l3.14 2.43A5.86 5.86 0 0 1 12 6.22Z"
      />
    </svg>
  );
}

function HomeView({
  bank,
  progress,
  options,
  setOptions,
  buildPool,
  startSession,
  continueSavedSession,
}: {
  bank: QuestionBank;
  progress: ProgressStore;
  options: SessionOptions;
  setOptions: React.Dispatch<React.SetStateAction<SessionOptions>>;
  buildPool: (options: SessionOptions) => Question[];
  startSession: (options?: SessionOptions) => boolean;
  continueSavedSession: () => boolean;
}) {
  const [emptyMessage, setEmptyMessage] = useState("");
  const [hasSavedSession] = useState(() =>
    typeof window === "undefined" ? false : Boolean(window.localStorage.getItem(SESSION_KEY)),
  );

  const previewCount = useMemo(() => buildPool(options).length, [buildPool, options]);
  const selectedMode = modeMeta.find((mode) => mode.id === options.mode) ?? modeMeta[3];
  const attempts = Object.values(progress.questions).reduce(
    (total, item) => total + item.attempts,
    0,
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = Object.values(progress.questions)
    .flatMap((item) => item.history)
    .filter((item) => item.at.slice(0, 10) === today).length;

  function update<K extends keyof SessionOptions>(key: K, value: SessionOptions[K]) {
    setEmptyMessage("");
    setOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="mx-auto grid max-w-[1480px] gap-7 px-4 py-6 sm:px-7 lg:grid-cols-[290px_minmax(0,1fr)] lg:py-8">
      <aside className="space-y-5">
        <section className="overflow-hidden rounded-[24px] bg-[#0b1f36] p-5 text-white shadow-[0_18px_45px_rgba(7,25,45,.18)]">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-cyan-200">오늘의 학습</p>
              <p className="mt-1 text-3xl font-black tracking-[-0.04em]">
                {todayCount.toLocaleString()}문제
              </p>
            </div>
            <Target className="size-7 text-[#4ee8bd]" />
          </div>
          <div className="flex items-end justify-between text-xs">
            <span className="text-slate-300">누적 풀이</span>
            <strong>{attempts.toLocaleString()}문제</strong>
          </div>
          <Progress
            value={Math.min(100, todayCount * 5)}
            className="mt-2 h-2 bg-white/15 [&>div]:bg-[#4ee8bd]"
          />
        </section>

        <nav aria-label="문제 풀이 유형" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {modeMeta.map((mode) => {
            const Icon = mode.icon;
            const active = mode.id === options.mode;
            return (
              <button
                key={mode.id}
                onClick={() => update("mode", mode.id)}
                aria-pressed={active}
                className={`group flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-transparent bg-card hover:border-border hover:bg-accent"
                }`}
              >
                <span
                  className={`grid size-10 place-items-center rounded-xl ${
                    active ? "bg-white/12" : "bg-secondary"
                  }`}
                >
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{mode.label}</span>
                  <span
                    className={`block truncate text-xs ${
                      active ? "text-slate-300 dark:text-slate-700" : "text-muted-foreground"
                    }`}
                  >
                    {mode.description}
                  </span>
                </span>
                <span
                  className={`text-[0.6875rem] font-bold ${
                    active ? "text-cyan-200 dark:text-cyan-900" : "text-muted-foreground"
                  }`}
                >
                  {navCount(mode.id, bank, progress)}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0">
        <div className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-lg">
              {bank.meta.firstYear}–{bank.meta.latestYear}
            </Badge>
            <span className="text-xs font-semibold text-muted-foreground">
              총 {bank.meta.examCount}회 · 원문 {bank.meta.questionCount.toLocaleString()}문항 ·
              통합 {bank.meta.uniqueQuestionCount.toLocaleString()}문항
            </span>
          </div>
          <h1 className="text-[clamp(1.75rem,4vw,2.65rem)] font-black tracking-[-0.045em]">
            {selectedMode.label}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {selectedMode.description}. 문제 문장과 선택지는 실제 기출 원문을 사용합니다.
          </p>
        </div>

        {hasSavedSession && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-950 sm:flex-row sm:items-center sm:justify-between dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-100">
            <div>
              <p className="font-extrabold">진행 중인 학습이 있습니다</p>
              <p className="text-sm opacity-75">마지막으로 풀던 위치에서 이어갈 수 있습니다.</p>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-cyan-300 bg-white/70 dark:bg-black/20"
              onClick={continueSavedSession}
            >
              이어 풀기
            </Button>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-[26px] border border-border bg-card p-5 shadow-[0_20px_60px_rgba(16,35,58,.06)] sm:p-7">
            <div className="grid gap-6">
              <fieldset>
                <legend className="mb-3 text-sm font-extrabold">풀이 방식</legend>
                <Tabs
                  value={options.type}
                  onValueChange={(value) => update("type", value as SessionType)}
                >
                  <TabsList className="grid h-12 w-full grid-cols-2 rounded-xl bg-secondary p-1">
                    <TabsTrigger value="study" className="rounded-lg font-bold">
                      학습 모드
                    </TabsTrigger>
                    <TabsTrigger value="exam" className="rounded-lg font-bold">
                      시험 모드
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {options.type === "study"
                    ? "한 문제를 풀 때마다 바로 상세 해설을 확인합니다."
                    : "모든 문제를 푼 뒤 제출하면 점수와 해설을 확인합니다."}
                </p>
              </fieldset>

              {options.mode === "round" ? (
                <fieldset>
                  <label htmlFor="exam-date" className="mb-2 block text-sm font-extrabold">
                    시험 회차
                  </label>
                  <NativeSelect
                    id="exam-date"
                    className="h-12 w-full rounded-xl"
                    value={options.examDate}
                    onChange={(event) => update("examDate", event.target.value)}
                  >
                    {[...bank.exams].reverse().map((exam) => (
                      <NativeSelectOption key={exam.date} value={exam.date}>
                        {formatExam(exam.date, exam.round)} · {exam.questionIds.length}문제
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </fieldset>
              ) : (
                <>
                  <div className="grid gap-5 md:grid-cols-2">
                    <fieldset>
                      <label htmlFor="year-range" className="mb-2 block text-sm font-extrabold">
                        출제 범위
                      </label>
                      <NativeSelect
                        id="year-range"
                        className="h-12 w-full rounded-xl"
                        value={options.yearRange}
                        onChange={(event) => update("yearRange", event.target.value as YearRange)}
                      >
                        <NativeSelectOption value="3">최근 3개년</NativeSelectOption>
                        <NativeSelectOption value="5">최근 5개년</NativeSelectOption>
                        <NativeSelectOption value="all">역대 전체</NativeSelectOption>
                      </NativeSelect>
                    </fieldset>
                    <fieldset>
                      <label htmlFor="subject" className="mb-2 block text-sm font-extrabold">
                        과목
                      </label>
                      <NativeSelect
                        id="subject"
                        className="h-12 w-full rounded-xl"
                        value={options.subject}
                        onChange={(event) => update("subject", event.target.value)}
                      >
                        <NativeSelectOption value="all">전체 과목</NativeSelectOption>
                        {bank.subjects.map((subject) => (
                          <NativeSelectOption key={subject} value={subject}>
                            {subject}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </fieldset>
                  </div>

                  <fieldset>
                    <legend className="mb-3 text-sm font-extrabold">문항 수</legend>
                    <div className="grid grid-cols-5 gap-2">
                      {(["5", "10", "25", "50", "all"] as QuestionCount[]).map((count) => (
                        <button
                          key={count}
                          onClick={() => update("count", count)}
                          aria-pressed={options.count === count}
                          className={`h-11 rounded-xl border text-sm font-extrabold transition-colors ${
                            options.count === count
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:bg-accent"
                          }`}
                        >
                          {count === "all" ? "무한" : count}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  {options.mode === "wrong" && (
                    <fieldset>
                      <label htmlFor="minimum-wrong" className="mb-2 block text-sm font-extrabold">
                        최소 오답 횟수
                      </label>
                      <NativeSelect
                        id="minimum-wrong"
                        className="h-12 w-full rounded-xl"
                        value={String(options.minimumWrong)}
                        onChange={(event) => update("minimumWrong", Number(event.target.value))}
                      >
                        {[1, 2, 3, 4, 5, 7, 10].map((count) => (
                          <NativeSelectOption key={count} value={count}>
                            {count}번 이상 틀린 문제
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </fieldset>
                  )}
                </>
              )}
            </div>
          </section>

          <aside className="flex flex-col rounded-[26px] bg-[#0b1f36] p-6 text-white shadow-[0_18px_45px_rgba(7,25,45,.16)]">
            <span className="grid size-12 place-items-center rounded-2xl bg-white/10 text-[#4ee8bd]">
              <selectedMode.icon className="size-6" />
            </span>
            <p className="mt-7 text-sm font-bold text-cyan-200">선택된 문제</p>
            <p className="mt-1 text-4xl font-black tracking-[-0.05em]">
              {previewCount.toLocaleString()}
              <span className="ml-1 text-lg">문제</span>
            </p>
            <div className="mt-5 space-y-2 border-t border-white/10 pt-5 text-sm text-slate-300">
              <p>{options.type === "study" ? "학습 모드 · 즉시 해설" : "시험 모드 · 일괄 채점"}</p>
              <p>
                {options.mode === "round"
                  ? formatExam(
                      options.examDate,
                      bank.exams.find((exam) => exam.date === options.examDate)?.round ?? 1,
                    )
                  : `${options.yearRange === "all" ? "역대 전체" : `최근 ${options.yearRange}개년`} · ${
                      options.subject === "all" ? "전체 과목" : options.subject
                    }`}
              </p>
            </div>
            <div className="mt-auto pt-8">
              {emptyMessage && (
                <p className="mb-3 rounded-xl bg-rose-500/15 p-3 text-sm text-rose-100">
                  {emptyMessage}
                </p>
              )}
              <Button
                size="lg"
                className="h-12 w-full gap-2 rounded-xl bg-[#4ee8bd] font-black text-[#08231d] hover:bg-[#6ef2ca]"
                onClick={() => {
                  if (!startSession()) {
                    setEmptyMessage(
                      options.mode === "wrong"
                        ? "조건에 맞는 오답이 없습니다. 최소 오답 횟수를 낮춰보세요."
                        : options.mode === "clips"
                          ? "선택한 범위에 클립한 문제가 없습니다."
                          : "선택한 조건에 맞는 문제가 없습니다.",
                    );
                  }
                }}
              >
                <Play className="size-4" fill="currentColor" /> 시작하기
              </Button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function SessionView({
  bank,
  explanations,
  active,
  setActive,
  progress,
  setProgress,
  onExit,
}: {
  bank: QuestionBank;
  explanations: ExplanationMap;
  active: ActiveSession;
  setActive: React.Dispatch<React.SetStateAction<ActiveSession | null>>;
  progress: ProgressStore;
  setProgress: React.Dispatch<React.SetStateAction<ProgressStore>>;
  onExit: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const questionById = useMemo(
    () => new Map(bank.questions.map((question) => [question.id, question])),
    [bank.questions],
  );
  const clusterById = useMemo(
    () => new Map(bank.clusters.map((cluster) => [cluster.id, cluster])),
    [bank.clusters],
  );
  const questions = active.questionIds
    .map((id) => questionById.get(id))
    .filter((question): question is Question => Boolean(question));
  const current = questions[active.index];

  if (!current) {
    return (
      <CenteredState
        icon={AlertTriangle}
        title="문제를 찾을 수 없습니다"
        description="문제 데이터가 갱신되었을 수 있습니다. 홈에서 새로 시작해 주세요."
      >
        <Button onClick={onExit}>홈으로</Button>
      </CenteredState>
    );
  }

  const currentProgress = progress.questions[current.clusterId] ?? emptyQuestionProgress();
  const currentExplanation = explanations[current.clusterId];
  const cluster = clusterById.get(current.clusterId);
  const isStudy = active.options.type === "study";
  const currentAnswer = active.answers[current.id];
  const isRevealed = active.gradedIds.includes(current.id) || active.submitted;
  const examScore = active.submitted
    ? questions.filter((question) => active.answers[question.id] === question.answer).length
    : 0;

  function choose(question: Question, answer: number) {
    if (active.submitted || (isStudy && active.gradedIds.includes(question.id))) return;
    setActive((session) =>
      session
        ? { ...session, answers: { ...session.answers, [question.id]: answer } }
        : session,
    );
  }

  function gradeCurrent() {
    if (!currentAnswer || active.gradedIds.includes(current.id)) return;
    const correct = currentAnswer === current.answer;
    setProgress((store) => recordAttempt(store, current, correct));
    setActive((session) =>
      session
        ? { ...session, gradedIds: [...session.gradedIds, current.id] }
        : session,
    );
  }

  function submitExam() {
    if (active.submitted) return;
    let nextProgress = progress;
    for (const question of questions) {
      if (!active.answers[question.id]) continue;
      nextProgress = recordAttempt(
        nextProgress,
        question,
        active.answers[question.id] === question.answer,
      );
    }
    setProgress(nextProgress);
    setActive((session) =>
      session
        ? { ...session, submitted: true, gradedIds: session.questionIds }
        : session,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function move(index: number) {
    setActive((session) => (session ? { ...session, index } : session));
    setMobileMenu(false);
    const showsAllExamQuestions =
      !isStudy && window.matchMedia("(min-width: 768px)").matches;
    if (showsAllExamQuestions) {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`question-${index + 1}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function toggleClip(question = current) {
    setProgress((store) => {
      const item = store.questions[question.clusterId] ?? emptyQuestionProgress();
      return {
        ...store,
        questions: {
          ...store.questions,
          [question.clusterId]: {
            ...item,
            clipped: !item.clipped,
            stateUpdatedAt: new Date().toISOString(),
          },
        },
      };
    });
  }

  function saveNote() {
    setProgress((store) => {
      const item = store.questions[current.clusterId] ?? emptyQuestionProgress();
      return {
        ...store,
        questions: {
          ...store.questions,
          [current.clusterId]: {
            ...item,
            clipped: true,
            note: noteDraft.trim(),
            stateUpdatedAt: new Date().toISOString(),
          },
        },
      };
    });
    setNoteOpen(false);
  }

  return (
    <>
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-7 lg:py-7">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={onExit}>
            <ChevronLeft className="size-4" /> 나가기
          </Button>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold text-muted-foreground">
              <span>
                {modeMeta.find((mode) => mode.id === active.options.mode)?.label} ·{" "}
                {isStudy ? "학습 모드" : "시험 모드"}
              </span>
              <span>
                {active.index + 1} / {questions.length}
              </span>
            </div>
            <Progress value={((active.index + 1) / questions.length) * 100} className="h-2" />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="rounded-xl md:hidden"
            aria-label="문제 번호 열기"
            onClick={() => setMobileMenu((value) => !value)}
          >
            <Menu className="size-4" />
          </Button>
        </div>

        {mobileMenu && (
          <QuestionNavigator
            questions={questions}
            active={active}
            onMove={move}
            onSubmit={isStudy ? undefined : submitExam}
            className="mb-5 md:hidden"
          />
        )}

        {active.submitted && (
          <section className="mb-6 overflow-hidden rounded-[24px] bg-[#0b1f36] p-6 text-white shadow-lg sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-cyan-200">시험 결과</p>
              <p className="mt-1 text-4xl font-black tracking-[-0.04em]">
                {examScore} / {questions.length}
              </p>
              <p className="mt-2 text-sm text-slate-300">
                정답률 {Math.round((examScore / questions.length) * 100)}% · 아래에서 모든 문제의
                정답과 해설을 확인하세요.
              </p>
            </div>
            <Button
              className="mt-5 rounded-xl bg-[#4ee8bd] font-black text-[#08231d] sm:mt-0"
              onClick={onExit}
            >
              학습 홈으로
            </Button>
          </section>
        )}

        {isStudy ? (
          <StudyQuestion
            question={current}
            index={active.index}
            cluster={cluster}
            explanation={currentExplanation}
            selected={currentAnswer}
            revealed={isRevealed}
            clipped={currentProgress.clipped}
            wrongCount={currentProgress.wrong}
            onChoose={(answer) => choose(current, answer)}
            onGrade={gradeCurrent}
            onClip={() => toggleClip()}
            onNote={() => {
              setNoteDraft(currentProgress.note);
              setNoteOpen(true);
            }}
            onPrevious={() => move(Math.max(0, active.index - 1))}
            onNext={() => {
              if (active.index === questions.length - 1) onExit();
              else move(active.index + 1);
            }}
            hasPrevious={active.index > 0}
            isLast={active.index === questions.length - 1}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
            <section className="min-w-0 space-y-5">
              <div className="md:hidden">
                <ExamQuestion
                  question={current}
                  index={active.index}
                  selected={currentAnswer}
                  submitted={active.submitted}
                  explanation={currentExplanation}
                  cluster={cluster}
                  clipped={currentProgress.clipped}
                  onChoose={(answer) => choose(current, answer)}
                  onClip={() => toggleClip()}
                />
                <div className="mt-4 flex justify-between gap-3">
                  <Button
                    variant="outline"
                    disabled={active.index === 0}
                    onClick={() => move(active.index - 1)}
                  >
                    <ChevronLeft className="size-4" /> 이전
                  </Button>
                  {active.index < questions.length - 1 ? (
                    <Button onClick={() => move(active.index + 1)}>
                      다음 <ChevronRight className="size-4" />
                    </Button>
                  ) : (
                    <Button onClick={submitExam}>시험 제출</Button>
                  )}
                </div>
              </div>

              <div className="hidden space-y-5 md:block">
                {questions.map((question, index) => {
                  const item = progress.questions[question.clusterId] ?? emptyQuestionProgress();
                  return (
                    <ExamQuestion
                      key={question.id}
                      question={question}
                      index={index}
                    anchorId={`question-${index + 1}`}
                      selected={active.answers[question.id]}
                      submitted={active.submitted}
                      explanation={explanations[question.clusterId]}
                      cluster={clusterById.get(question.clusterId)}
                      clipped={item.clipped}
                      onChoose={(answer) => choose(question, answer)}
                      onClip={() => toggleClip(question)}
                    />
                  );
                })}
                {!active.submitted && (
                  <Button
                    size="lg"
                    className="h-14 w-full rounded-2xl text-base font-black"
                    onClick={submitExam}
                  >
                    시험 제출하고 채점하기
                  </Button>
                )}
              </div>
            </section>

            <aside className="hidden lg:block">
              <QuestionNavigator
                questions={questions}
                active={active}
                onMove={move}
                onSubmit={submitExam}
                sticky
              />
            </aside>
          </div>
        )}
      </div>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>클립 메모</DialogTitle>
            <DialogDescription>
              이 문제에서 헷갈렸던 부분을 기록해 두세요. 로그인 상태에서는 클라우드에도
              동기화됩니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="예: ARP 요청과 응답의 전송 방식을 다시 확인"
            className="min-h-32"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>
              취소
            </Button>
            <Button onClick={saveNote}>클립하고 저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StudyQuestion({
  question,
  index,
  cluster,
  explanation,
  selected,
  revealed,
  clipped,
  wrongCount,
  onChoose,
  onGrade,
  onClip,
  onNote,
  onPrevious,
  onNext,
  hasPrevious,
  isLast,
}: {
  question: Question;
  index: number;
  cluster?: QuestionBank["clusters"][number];
  explanation?: Explanation;
  selected?: number;
  revealed: boolean;
  clipped: boolean;
  wrongCount: number;
  onChoose: (answer: number) => void;
  onGrade: () => void;
  onClip: () => void;
  onNote: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  isLast: boolean;
}) {
  return (
    <article className="grid overflow-hidden rounded-[26px] border border-border bg-card shadow-[0_20px_60px_rgba(16,35,58,.08)] xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]">
      <section className="p-5 sm:p-8 xl:border-r xl:border-border">
        <QuestionHead
          question={question}
          index={index}
          cluster={cluster}
          clipped={clipped}
          wrongCount={wrongCount}
          onClip={onClip}
        />
        <OptionList
          question={question}
          selected={selected}
          revealed={revealed}
          onChoose={onChoose}
        />
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-4" />
            <span>
              {question.examDate}
              {cluster && cluster.totalCount > 1 ? ` 외 ${cluster.totalCount - 1}회` : ""}
            </span>
          </div>
          {!revealed ? (
            <Button
              size="lg"
              disabled={!selected}
              onClick={onGrade}
              className="rounded-xl px-6 font-extrabold"
            >
              정답 확인
            </Button>
          ) : (
            <Button size="lg" onClick={onNext} className="gap-2 rounded-xl px-6 font-extrabold">
              {isLast ? "학습 마치기" : "다음 문제"} <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-5 flex items-center gap-2 border-t border-border pt-5">
          <Button variant="ghost" size="sm" disabled={!hasPrevious} onClick={onPrevious}>
            <ChevronLeft className="size-4" /> 이전 문제
          </Button>
          <Button variant="ghost" size="sm" onClick={onNote}>
            <Bookmark className="size-4" /> 클립 메모
          </Button>
        </div>
      </section>

      <aside
        className={`relative p-5 transition-colors sm:p-8 ${
          revealed ? "bg-[#f1f8f6] dark:bg-[#0d2924]" : "bg-secondary/35"
        }`}
      >
        {revealed ? (
          <ExplanationPanel question={question} explanation={explanation} selected={selected} />
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-5 text-center">
            <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-background shadow-sm">
              <BookOpenCheck className="size-7 text-primary" />
            </span>
            <h3 className="text-lg font-extrabold">답을 고른 뒤 해설을 확인하세요</h3>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              정답의 근거와 네 개 선택지의 차이, 함께 알아야 할 개념이 여기에 표시됩니다.
            </p>
          </div>
        )}
      </aside>
    </article>
  );
}

function ExamQuestion({
  question,
  index,
  anchorId,
  selected,
  submitted,
  explanation,
  cluster,
  clipped,
  onChoose,
  onClip,
}: {
  question: Question;
  index: number;
  anchorId?: string;
  selected?: number;
  submitted: boolean;
  explanation?: Explanation;
  cluster?: QuestionBank["clusters"][number];
  clipped: boolean;
  onChoose: (answer: number) => void;
  onClip: () => void;
}) {
  return (
    <article
      id={anchorId}
      className="scroll-mt-24 rounded-[24px] border border-border bg-card p-5 shadow-sm sm:p-7"
    >
      <QuestionHead
        question={question}
        index={index}
        cluster={cluster}
        clipped={clipped}
        wrongCount={0}
        onClip={onClip}
      />
      <OptionList
        question={question}
        selected={selected}
        revealed={submitted}
        onChoose={onChoose}
      />
      {submitted && (
        <div className="mt-6 rounded-2xl bg-[#f1f8f6] p-5 dark:bg-[#0d2924]">
          <ExplanationPanel question={question} explanation={explanation} selected={selected} compact />
        </div>
      )}
    </article>
  );
}

function QuestionHead({
  question,
  index,
  cluster,
  clipped,
  wrongCount,
  onClip,
}: {
  question: Question;
  index: number;
  cluster?: QuestionBank["clusters"][number];
  clipped: boolean;
  wrongCount: number;
  onClip: () => void;
}) {
  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="rounded-lg bg-[#0b1f36] text-white">{question.subject}</Badge>
          {cluster && cluster.totalCount > 1 && (
            <Badge
              variant="outline"
              className="rounded-lg border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200"
            >
              <Flame className="mr-1 size-3" /> 동일 문항 {cluster.totalCount}회
            </Badge>
          )}
          {wrongCount > 0 && (
            <Badge variant="destructive" className="rounded-lg">
              누적 오답 {wrongCount}회
            </Badge>
          )}
        </div>
        <button
          aria-label={clipped ? "클립 해제" : "문제 클립"}
          aria-pressed={clipped}
          onClick={onClip}
          className={`grid size-11 shrink-0 place-items-center rounded-xl border transition-colors ${
            clipped
              ? "border-[#0b1f36] bg-[#0b1f36] text-[#4ee8bd]"
              : "border-border bg-background hover:bg-accent"
          }`}
        >
          <Bookmark className="size-5" fill={clipped ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="mb-7 flex items-start gap-3">
        <span className="text-lg font-black text-primary">Q{index + 1}.</span>
        <h2 className="text-lg font-bold leading-[1.7] tracking-[-0.018em] sm:text-xl">
          {cleanDisplayText(question.stem)}
        </h2>
      </div>
    </>
  );
}

function OptionList({
  question,
  selected,
  revealed,
  onChoose,
}: {
  question: Question;
  selected?: number;
  revealed: boolean;
  onChoose: (answer: number) => void;
}) {
  return (
    <div className="grid gap-3">
      {question.options.map((option, index) => {
        const number = index + 1;
        const isSelected = selected === number;
        const isCorrect = revealed && number === question.answer;
        const isWrong = revealed && isSelected && number !== question.answer;
        return (
          <button
            key={`${question.id}-${number}`}
            disabled={revealed}
            aria-pressed={isSelected}
            onClick={() => onChoose(number)}
            className={`group flex items-start gap-3 rounded-2xl border p-4 text-left text-[0.9375rem] leading-6 transition-all ${
              isCorrect
                ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
                : isWrong
                  ? "border-rose-400 bg-rose-50 text-rose-950 dark:bg-rose-950 dark:text-rose-100"
                  : isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/45 hover:bg-accent/60"
            }`}
          >
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-black ${
                isSelected || isCorrect ? "border-current" : "border-border"
              }`}
            >
              {isCorrect ? <Check className="size-4" /> : isWrong ? <X className="size-4" /> : number}
            </span>
            <span>{cleanDisplayText(option)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExplanationPanel({
  question,
  explanation,
  selected,
  compact = false,
}: {
  question: Question;
  explanation?: Explanation;
  selected?: number;
  compact?: boolean;
}) {
  const correct = selected === question.answer;
  const optionExplanations = question.options.map((option, index) =>
    resolveOptionExplanation(option, index, explanation),
  );
  if (!explanation) {
    return (
      <div className="space-y-5 text-[0.9375rem] leading-7">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-11 place-items-center rounded-full text-white ${
              correct ? "bg-emerald-600" : "bg-rose-500"
            }`}
          >
            {correct ? <Check className="size-5" /> : <X className="size-5" />}
          </span>
          <div>
            <p className="text-xs font-bold text-muted-foreground">
              정답 {question.answer}번
            </p>
            <h3 className="font-black">
              {cleanDisplayText(question.options[question.answer - 1] ?? "")}
            </h3>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
          <p className="font-extrabold">C등급 빠른 확인</p>
          <p className="mt-1 text-sm leading-6 opacity-80">
            교사용 기출 정답 기준으로 {question.answer}번이 정답입니다. C등급은 1회 출제 중심의
            저빈도 보충 문항으로, 앞서 정한 기준에 따라 정답과 출제 이력만 제공합니다. 상세 해설은
            빈출 해설 대상 1,197문항에 제공됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`animate-in fade-in slide-in-from-bottom-2 duration-300 ${compact ? "text-sm" : ""}`}>
      <div className="mb-5 flex items-center gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full text-white ${
            correct ? "bg-emerald-600" : "bg-rose-500"
          }`}
        >
          {correct ? <Check className="size-5" /> : <X className="size-5" />}
        </span>
        <div>
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
            정답 {question.answer}번
          </p>
          <h3 className="text-lg font-black">{explanation.title}</h3>
        </div>
      </div>
      <div className="space-y-5 text-[0.9375rem] leading-7">
        <section>
          <h4 className="mb-1 font-extrabold">정답인 이유</h4>
          <p>{explanation.rationale}</p>
        </section>
        <section>
          <h4 className="mb-2 font-extrabold">선택지별 해설</h4>
          <ol className="space-y-2.5">
            {question.options.map((option, index) => (
              <li key={option}>
                <strong>
                  {["①", "②", "③", "④"][index]}{" "}
                  {index + 1 === question.answer ? "옳음." : "틀림."}
                </strong>{" "}
                {optionExplanations[index] ?? "해설을 검수하고 있습니다."}
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-2xl border border-emerald-200 bg-white/70 p-4 dark:border-emerald-900 dark:bg-black/15">
          <h4 className="mb-1 flex items-center gap-2 font-extrabold">
            <CircleAlert className="size-4" /> 개념 해설
          </h4>
          <p className="whitespace-pre-line">{explanation.concept}</p>
        </section>
      </div>
    </div>
  );
}

function normalizeOptionKey(value: string) {
  return cleanDisplayText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function optionSimilarity(left: string, right: string) {
  const a = normalizeOptionKey(left);
  const b = normalizeOptionKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const pairs = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      result.set(pair, (result.get(pair) ?? 0) + 1);
    }
    return result;
  };
  const leftPairs = pairs(a);
  const rightPairs = pairs(b);
  let overlap = 0;
  for (const [pair, count] of leftPairs) {
    overlap += Math.min(count, rightPairs.get(pair) ?? 0);
  }
  return (2 * overlap) / Math.max(1, a.length + b.length - 2);
}

function resolveOptionExplanation(
  option: string,
  index: number,
  explanation?: Explanation,
) {
  if (!explanation) return undefined;
  const details = explanation.optionDetails ?? [];
  if (details.length) {
    const best = details
      .map((detail) => ({ detail, score: optionSimilarity(option, detail.option) }))
      .sort((left, right) => right.score - left.score)[0];
    if (best?.score >= 0.28) return best.detail.explanation;
  }
  return explanation.optionExplanations[index];
}

function QuestionNavigator({
  questions,
  active,
  onMove,
  onSubmit,
  sticky = false,
  className = "",
}: {
  questions: Question[];
  active: ActiveSession;
  onMove: (index: number) => void;
  onSubmit?: () => void;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${
        sticky ? "sticky top-24" : ""
      } ${className}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-extrabold">문제 번호</p>
        <span className="text-xs text-muted-foreground">
          {Object.keys(active.answers).length}/{questions.length} 답변
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {questions.map((question, index) => {
          const answered = Boolean(active.answers[question.id]);
          const current = index === active.index;
          const correct =
            active.submitted && active.answers[question.id] === question.answer;
          const wrong =
            active.submitted && active.answers[question.id] !== question.answer;
          return (
            <button
              key={question.id}
              onClick={() => onMove(index)}
              className={`aspect-square rounded-lg border text-xs font-black transition-colors ${
                correct
                  ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                  : wrong
                    ? "border-rose-400 bg-rose-100 text-rose-900"
                    : current
                      ? "border-primary bg-primary text-primary-foreground"
                      : answered
                        ? "border-cyan-300 bg-cyan-50 text-cyan-950"
                        : "border-border hover:bg-accent"
              } ${current ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""}`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      {onSubmit && !active.submitted && (
        <Button
          type="button"
          className="mt-4 h-11 w-full rounded-xl font-black"
          onClick={onSubmit}
        >
          문제 제출
        </Button>
      )}
    </section>
  );
}

function ProfileView({
  bank,
  progress,
  cloud,
  onReset,
}: {
  bank: QuestionBank;
  progress: ProgressStore;
  cloud: ReturnType<typeof useCloudProgress>;
  onReset: () => void | Promise<void>;
}) {
  const entries = Object.entries(progress.questions);
  const allHistory = entries.flatMap(([, item]) => item.history);
  const totalAttempts = entries.reduce((sum, [, item]) => sum + item.attempts, 0);
  const totalWrong = entries.reduce((sum, [, item]) => sum + item.wrong, 0);
  const clipped = entries.filter(([, item]) => item.clipped).length;
  const wrongQuestions = entries.filter(([, item]) => item.wrong > 0).length;
  const [now] = useState(() => Date.now());
  const recentCount = (days: number) =>
    allHistory.filter(
      (item) => now - new Date(item.at).getTime() <= days * 24 * 60 * 60 * 1000,
    ).length;

  const subjectStats = bank.subjects.map((subject) => {
    const attempts = allHistory.filter((item) => item.subject === subject);
    const wrong = attempts.filter((item) => !item.correct).length;
    return {
      subject,
      attempts: attempts.length,
      wrong,
      rate: attempts.length ? Math.round((wrong / attempts.length) * 100) : 0,
    };
  });

  const topicMap = new Map<string, { attempts: number; wrong: number }>();
  for (const item of allHistory) {
    const current = topicMap.get(item.topic) ?? { attempts: 0, wrong: 0 };
    current.attempts += 1;
    if (!item.correct) current.wrong += 1;
    topicMap.set(item.topic, current);
  }
  const weakTopics = [...topicMap.entries()]
    .map(([topic, stats]) => ({
      topic,
      ...stats,
      rate: stats.attempts ? Math.round((stats.wrong / stats.attempts) * 100) : 0,
    }))
    .filter((item) => item.wrong > 0)
    .sort((left, right) => right.rate - left.rate || right.wrong - left.wrong)
    .slice(0, 8);

  const hardest = entries
    .filter(([, item]) => item.wrong > 0)
    .sort(([, left], [, right]) => right.wrong - left.wrong)
    .slice(0, 8);
  const questionByCluster = new Map(
    bank.clusters.map((cluster) => [
      cluster.id,
      bank.questions.find((question) => question.id === cluster.representativeId),
    ]),
  );

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-7 sm:px-7 lg:py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="secondary" className="mb-2 rounded-lg">
            {cloud.user ? "기기 및 클라우드에 자동 저장" : "이 브라우저에 자동 저장"}
          </Badge>
          <h1 className="text-[clamp(1.8rem,4vw,2.7rem)] font-black tracking-[-0.045em]">
            나의 학습
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {cloud.user
              ? "로그인한 기기들의 풀이 기록을 합쳐서 계산합니다."
              : "이 기기와 브라우저에서 풀이한 기록을 기준으로 계산합니다."}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="gap-2 rounded-xl text-destructive">
              <Trash2 className="size-4" /> 학습 기록 초기화
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>모든 학습 기록을 지울까요?</AlertDialogTitle>
              <AlertDialogDescription>
                오답 횟수, 클립, 메모와 학습 통계가 모두 삭제됩니다.
                {cloud.user ? " 클라우드에 저장된 기록도 함께 삭제됩니다." : ""} 삭제한 기록은
                복구할 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={onReset}>모두 삭제</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={ListChecks} label="총 풀이" value={totalAttempts} suffix="문제" />
        <MetricCard
          icon={Target}
          label="전체 오답률"
          value={totalAttempts ? Math.round((totalWrong / totalAttempts) * 100) : 0}
          suffix="%"
        />
        <MetricCard icon={RotateCcw} label="오답 문제" value={wrongQuestions} suffix="개" />
        <MetricCard icon={Bookmark} label="클립" value={clipped} suffix="개" />
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-cyan-100 text-cyan-950 dark:bg-cyan-950 dark:text-cyan-100">
              <CalendarDays className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold text-muted-foreground">최근 7일</p>
              <p className="text-2xl font-black">{recentCount(7).toLocaleString()}문제</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100">
              <History className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold text-muted-foreground">최근 30일</p>
              <p className="text-2xl font-black">{recentCount(30).toLocaleString()}문제</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[24px] border border-border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-black">과목별 오답률</h2>
          <div className="mt-5 space-y-5">
            {subjectStats.map((item) => (
              <div key={item.subject}>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-bold">{item.subject}</span>
                  <span className="text-muted-foreground">
                    {item.wrong}/{item.attempts} · {item.rate}%
                  </span>
                </div>
                <Progress value={item.rate} className="h-2.5" />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-black">취약 개념</h2>
          {weakTopics.length ? (
            <div className="mt-4 grid gap-3">
              {weakTopics.map((item, index) => (
                <div
                  key={item.topic}
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-secondary text-xs font-black">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{item.topic}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.attempts}회 풀이 · {item.wrong}회 오답
                    </p>
                  </div>
                  <Badge variant={item.rate >= 60 ? "destructive" : "secondary"}>
                    {item.rate}%
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyMini text="문제를 풀면 취약 개념을 분석해 드립니다." />
          )}
        </section>
      </div>

      <section className="mt-6 rounded-[24px] border border-border bg-card p-5 sm:p-6">
        <h2 className="text-lg font-black">자주 틀린 문제</h2>
        {hardest.length ? (
          <div className="mt-4 divide-y divide-border">
            {hardest.map(([clusterId, item]) => {
              const question = questionByCluster.get(clusterId);
              return (
                <div key={clusterId} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                  <Badge variant="destructive" className="mt-0.5 shrink-0 rounded-lg">
                    {item.wrong}회
                  </Badge>
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-bold leading-6">
                      {question ? cleanDisplayText(question.stem) : clusterId}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {question?.subject} · {item.attempts}회 풀이
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyMini text="아직 틀린 문제가 없습니다." />
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: typeof Target;
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <Icon className="size-5 text-muted-foreground" />
      <p className="mt-5 text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-[-0.04em]">
        {value.toLocaleString()}
        <span className="ml-1 text-sm">{suffix}</span>
      </p>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function CenteredState({
  icon: Icon,
  title,
  description,
  spin = false,
  children,
}: {
  icon: typeof LoaderCircle;
  title: string;
  description: string;
  spin?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-secondary">
          <Icon className={`size-7 ${spin ? "animate-spin" : ""}`} />
        </span>
        <h1 className="mt-5 text-xl font-black">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </main>
  );
}
