"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Cloud,
  CloudOff,
  Clock3,
  Flame,
  FileUp,
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
  Search,
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  importNotionWrongAttempts,
  loadProgress,
  NotionWrongImportSummary,
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

type View = "home" | "wrong-notes" | "session" | "profile";
type WrongNoteStatus = "all" | "needs-review" | "recovered";
type WrongNoteSort = "recent" | "most-wrong" | "subject";
type WrongNoteFilters = {
  query: string;
  subject: string;
  minimumWrong: number;
  status: WrongNoteStatus;
  sort: WrongNoteSort;
};
type ActiveSession = {
  options: SessionOptions;
  questionIds: string[];
  index: number;
  answers: Record<string, number>;
  gradedIds: string[];
  skippedIds?: string[];
  submitted: boolean;
  studyFinished?: boolean;
  studyEndedEarly?: boolean;
  returnView?: Exclude<View, "session">;
  returnScrollY?: number;
};

const defaultWrongNoteFilters: WrongNoteFilters = {
  query: "",
  subject: "all",
  minimumWrong: 1,
  status: "all",
  sort: "recent",
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
  { id: "frequent", label: "고빈도 문제", description: "선택한 기간의 빈출 문제를 무작위 출제", icon: Flame },
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
  const [wrongNoteFilters, setWrongNoteFilters] = useState(defaultWrongNoteFilters);
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

  function navigateTo(nextView: View) {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    }

    const desired = nextOptions.count === "all" ? candidates.length : Number(nextOptions.count);
    // 고빈도 문제는 출제 횟수가 높은 문제부터 필요한 수만큼 선별한 다음
    // 풀이 순서만 섞는다. 그 외 비회차 모드는 전체 후보를 먼저 섞는다.
    const selected =
      nextOptions.mode === "frequent"
        ? shuffled(candidates.slice(0, desired))
        : shuffled(candidates).slice(0, desired);
    return selected.map((item) => item.latest);
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
      skippedIds: [],
      submitted: false,
      returnView: "home",
    });
    setView("session");
    window.scrollTo({ top: 0 });
    return true;
  }

  function startReviewSession(
    questionIds: string[],
    returnView: Exclude<View, "session"> = "wrong-notes",
  ) {
    if (!bank || !questionIds.length) return false;
    const validQuestionIds = questionIds.filter((id) =>
      bank.questions.some((question) => question.id === id),
    );
    if (!validQuestionIds.length) return false;
    setActive({
      options: {
        ...defaultOptions,
        mode: "wrong",
        type: "study",
        yearRange: "all",
        subject: "all",
        count: "all",
      },
      questionIds: validQuestionIds,
      index: 0,
      answers: {},
      gradedIds: [],
      skippedIds: [],
      submitted: false,
      returnView,
      returnScrollY: questionIds.length === 1 ? window.scrollY : 0,
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
      <div
        className={`min-h-screen bg-background text-foreground ${
          view === "session" ? "" : "pb-24 md:pb-0"
        }`}
      >
        <AppHeader
          view={view}
          dark={dark}
          fontScale={fontScale}
          cloud={cloud}
          onView={navigateTo}
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
            onOpenWrongNotes={() => navigateTo("wrong-notes")}
          />
        )}

        {view === "wrong-notes" && (
          <WrongNotesView
            bank={bank}
            progress={progress}
            filters={wrongNoteFilters}
            setFilters={setWrongNoteFilters}
            onStartQuestions={(questionIds) => startReviewSession(questionIds, "wrong-notes")}
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
              const returnScrollY = active.returnScrollY ?? 0;
              setView(active.returnView ?? "home");
              setActive(null);
              window.setTimeout(() => window.scrollTo({ top: returnScrollY }), 0);
            }}
            exitLabel={
              active.returnView === "wrong-notes"
                ? "오답 노트로"
                : active.returnView === "profile"
                  ? "나의 학습으로"
                  : "나가기"
            }
          />
        )}

        {view === "profile" && (
          <ProfileView
            bank={bank}
            progress={progress}
            cloud={cloud}
            onOpenWrongNotes={() => navigateTo("wrong-notes")}
            onStartQuestion={(questionId) => startReviewSession([questionId], "profile")}
            onImportNotion={(value) => {
              const imported = importNotionWrongAttempts(progress, bank, value);
              setProgress(imported.store);
              return imported.summary;
            }}
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

        {view !== "session" && (
          <MobileNavigation
            view={view}
            wrongCount={Object.values(progress.questions).filter((item) => item.wrong > 0).length}
            onView={navigateTo}
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
  const [homePressed, setHomePressed] = useState(false);
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

  useEffect(() => {
    if (!homePressed) return;
    const timer = window.setTimeout(() => setHomePressed(false), 260);
    return () => window.clearTimeout(timer);
  }, [homePressed]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-2 px-3 sm:gap-3 sm:px-7">
          <button
            type="button"
            aria-label="홈으로 이동"
            aria-current={view === "home" ? "page" : undefined}
            className={`group flex min-w-0 items-center gap-3 rounded-2xl px-1.5 py-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] ${
              homePressed
                ? "scale-[0.96] bg-primary/12 ring-2 ring-primary/30"
                : view === "home"
                  ? "bg-secondary/85 hover:bg-secondary"
                  : "hover:bg-accent"
            }`}
            onClick={() => {
              setHomePressed(true);
              onView("home");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-sm transition-transform duration-150 ${
                homePressed ? "scale-90" : "group-active:scale-90"
              }`}
            >
              <Network className="size-5" strokeWidth={2.2} />
            </span>
            <span className="hidden min-w-0 text-left min-[560px]:block">
              <span className="block truncate text-[0.9375rem] font-extrabold tracking-[-0.02em]">
                네트워크관리사
              </span>
              <span className="hidden text-xs font-semibold text-muted-foreground sm:block">
                문제은행
              </span>
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
              variant={view === "wrong-notes" ? "secondary" : "ghost"}
              className="gap-2 rounded-xl"
              onClick={() => onView("wrong-notes")}
            >
              <RotateCcw className="size-4" /> 오답 노트
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

function MobileNavigation({
  view,
  wrongCount,
  onView,
}: {
  view: View;
  wrongCount: number;
  onView: (view: View) => void;
}) {
  const items: Array<{
    id: Exclude<View, "session">;
    label: string;
    icon: typeof Home;
  }> = [
    { id: "home", label: "문제 풀이", icon: Home },
    { id: "wrong-notes", label: "오답 노트", icon: RotateCcw },
    { id: "profile", label: "나의 학습", icon: BarChart3 },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-3 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(15,23,42,.08)] backdrop-blur-xl md:hidden"
      aria-label="모바일 주요 메뉴"
    >
      <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onView(item.id)}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[0.6875rem] font-extrabold transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className="relative">
                <Icon className="size-5" />
                {item.id === "wrong-notes" && wrongCount > 0 && (
                  <span className="absolute -right-3 -top-2 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[0.5625rem] leading-4 text-white">
                    {wrongCount > 99 ? "99+" : wrongCount}
                  </span>
                )}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
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
  onOpenWrongNotes,
}: {
  bank: QuestionBank;
  progress: ProgressStore;
  options: SessionOptions;
  setOptions: React.Dispatch<React.SetStateAction<SessionOptions>>;
  buildPool: (options: SessionOptions) => Question[];
  startSession: (options?: SessionOptions) => boolean;
  continueSavedSession: () => boolean;
  onOpenWrongNotes: () => void;
}) {
  const [emptyMessage, setEmptyMessage] = useState("");
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [hasSavedSession] = useState(() =>
    typeof window === "undefined" ? false : Boolean(window.localStorage.getItem(SESSION_KEY)),
  );

  const previewCount = useMemo(() => buildPool(options).length, [buildPool, options]);
  const selectedMode = modeMeta.find((mode) => mode.id === options.mode) ?? modeMeta[3];
  const examsNewestFirst = useMemo(
    () => [...bank.exams].sort((left, right) => right.date.localeCompare(left.date)),
    [bank.exams],
  );
  const examYears = useMemo(
    () => [...new Set(examsNewestFirst.map((exam) => exam.year))],
    [examsNewestFirst],
  );
  const selectedExam = bank.exams.find((exam) => exam.date === options.examDate);
  const selectedExamYear = selectedExam?.year ?? examYears[0] ?? bank.meta.latestYear;
  const examsForSelectedYear = examsNewestFirst.filter(
    (exam) => exam.year === selectedExamYear,
  );
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
      <section className="rounded-[24px] border border-sky-200 bg-gradient-to-br from-sky-50 to-blue-100 p-5 text-[#173a6a] shadow-sm dark:border-[#294463] dark:from-[#163b60] dark:to-[#102a46] dark:text-[#edf6ff] lg:hidden">
        <Badge className="rounded-lg bg-primary text-primary-foreground">네트워크관리사 2급</Badge>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.04em]">기출 문제은행</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-[#526b8b] dark:text-[#c3d7ec]">
          실제 필기 기출을 회차별·오답·랜덤·고빈도 방식으로 풀고 상세 해설로 복습하는
          학습 페이지입니다.
        </p>
      </section>
      <aside className="space-y-5">
        <section className="overflow-hidden rounded-[24px] border border-[#cfe0f7] bg-[#e5f0ff] p-5 text-[#173a6a] shadow-[0_18px_45px_rgba(37,99,235,.11)] dark:border-[#294463] dark:bg-[#163b60] dark:text-[#edf6ff]">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-[#2563eb] dark:text-[#93c5fd]">오늘의 학습</p>
              <p className="mt-1 text-3xl font-black tracking-[-0.04em]">
                {todayCount.toLocaleString()}문제
              </p>
            </div>
            <Target className="size-7 text-[#2563eb] dark:text-[#60a5fa]" />
          </div>
          <div className="flex items-end justify-between text-xs">
            <span className="text-[#62738c] dark:text-[#b9cbe0]">누적 풀이</span>
            <strong>{attempts.toLocaleString()}문제</strong>
          </div>
          <Progress
            value={Math.min(100, todayCount * 5)}
            className="mt-2 h-2 bg-[#2563eb]/15 [&>div]:bg-[#2563eb] dark:bg-white/15 dark:[&>div]:bg-[#60a5fa]"
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
                      active ? "text-blue-100 dark:text-blue-950" : "text-muted-foreground"
                    }`}
                  >
                    {mode.description}
                  </span>
                </span>
                <span
                  className={`text-[0.6875rem] font-bold ${
                    active ? "text-blue-100 dark:text-blue-950" : "text-muted-foreground"
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
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
            <div>
              <p className="font-extrabold">진행 중인 학습이 있습니다</p>
              <p className="text-sm opacity-75">마지막으로 풀던 위치에서 이어갈 수 있습니다.</p>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-blue-300 bg-white/70 dark:bg-black/20"
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
                  <legend className="text-sm font-extrabold">시험 회차</legend>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    연도를 고른 뒤 해당 연도의 회차를 선택하세요.
                  </p>

                  <div className="mt-4">
                    <span className="mb-2 block text-xs font-bold text-muted-foreground">
                      연도
                    </span>
                    <Popover open={yearPickerOpen} onOpenChange={setYearPickerOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="시험 연도 선택"
                          className="flex h-12 w-full items-center justify-between rounded-xl border border-input bg-background px-4 text-sm font-extrabold shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="flex items-center gap-2">
                            <CalendarDays className="size-4 text-muted-foreground" />
                            {selectedExamYear}년
                          </span>
                          <ChevronDown
                            className={`size-4 text-muted-foreground transition-transform ${
                              yearPickerOpen ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        side="bottom"
                        sideOffset={6}
                        className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-3"
                      >
                        <p className="px-1 pb-2 text-sm font-extrabold">연도 선택</p>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                          {examYears.map((year) => {
                            const selected = year === selectedExamYear;
                            return (
                              <button
                                key={year}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => {
                                  const newestExam = examsNewestFirst.find(
                                    (exam) => exam.year === year,
                                  );
                                  if (newestExam) update("examDate", newestExam.date);
                                  setYearPickerOpen(false);
                                }}
                                className={`h-10 rounded-xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                                  selected
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-accent"
                                }`}
                              >
                                {year}년
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${selectedExamYear}년 시험 회차`}>
                    {examsForSelectedYear.map((exam) => {
                      const selected = exam.date === options.examDate;
                      return (
                        <button
                          key={exam.date}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => update("examDate", exam.date)}
                          className={`relative min-h-24 rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                            selected
                              ? "border-primary bg-primary/8 shadow-sm ring-1 ring-primary/20"
                              : "border-border bg-background hover:border-primary/45 hover:bg-accent"
                          }`}
                        >
                          {selected && (
                            <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3.5" strokeWidth={3} />
                            </span>
                          )}
                          <span className="block text-sm font-black">제{String(exam.round).padStart(2, "0")}회</span>
                          <span className="mt-1 block text-xs font-semibold text-muted-foreground">
                            {exam.date.slice(5).replace("-", ".")}
                          </span>
                          <span className="mt-3 block text-xs text-muted-foreground">
                            {exam.questionIds.length}문제
                          </span>
                        </button>
                      );
                    })}
                  </div>
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

          <aside className="flex flex-col rounded-[26px] bg-[#173a6a] p-6 text-white shadow-[0_18px_45px_rgba(37,99,235,.16)] dark:bg-[#102238]">
            <span className="grid size-12 place-items-center rounded-2xl bg-white/10 text-[#7dd3fc]">
              <selectedMode.icon className="size-6" />
            </span>
            <p className="mt-7 text-sm font-bold text-blue-200">선택된 문제</p>
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
                className="h-12 w-full gap-2 rounded-xl bg-[#38bdf8] font-black text-[#0c2e4e] hover:bg-[#7dd3fc]"
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
              {options.mode === "wrong" && (
                <Button
                  variant="ghost"
                  className="mt-2 h-11 w-full gap-2 rounded-xl text-blue-100 hover:bg-white/10 hover:text-white"
                  onClick={onOpenWrongNotes}
                >
                  <ListChecks className="size-4" /> 오답 목록 보기
                </Button>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function WrongNotesView({
  bank,
  progress,
  filters,
  setFilters,
  onStartQuestions,
}: {
  bank: QuestionBank;
  progress: ProgressStore;
  filters: WrongNoteFilters;
  setFilters: React.Dispatch<React.SetStateAction<WrongNoteFilters>>;
  onStartQuestions: (questionIds: string[]) => boolean;
}) {
  const { query, subject, minimumWrong, status, sort } = filters;
  const questionById = useMemo(
    () => new Map(bank.questions.map((question) => [question.id, question])),
    [bank.questions],
  );

  const wrongNotes = useMemo(() => {
    return bank.clusters
      .map((cluster) => {
        const item = progress.questions[cluster.id];
        if (!item || item.wrong < 1) return null;
        const lastWrongAttempt = [...item.history]
          .reverse()
          .find((attempt) => !attempt.correct);
        const latestOccurrence = cluster.occurrenceIds
          .map((id) => questionById.get(id))
          .filter((question): question is Question => Boolean(question))
          .sort(
            (left, right) =>
              right.examDate.localeCompare(left.examDate) || right.number - left.number,
          )[0];
        const question =
          questionById.get(lastWrongAttempt?.questionId ?? "") ??
          latestOccurrence ??
          questionById.get(cluster.representativeId);
        if (!question) return null;
        const lastAttempt = item.history.at(-1);
        return {
          clusterId: cluster.id,
          question,
          progress: item,
          recovered: lastAttempt?.correct === true,
          lastWrongAt: lastWrongAttempt?.at ?? item.lastAnsweredAt ?? "",
        };
      })
      .filter(
        (
          item,
        ): item is {
          clusterId: string;
          question: Question;
          progress: ProgressStore["questions"][string];
          recovered: boolean;
          lastWrongAt: string;
        } => Boolean(item),
      );
  }, [bank.clusters, progress.questions, questionById]);

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return wrongNotes
      .filter(({ question, progress: item, recovered }) => {
        if (subject !== "all" && question.subject !== subject) return false;
        if (item.wrong < minimumWrong) return false;
        if (status === "needs-review" && recovered) return false;
        if (status === "recovered" && !recovered) return false;
        if (
          normalizedQuery &&
          !cleanDisplayText(question.stem).toLowerCase().includes(normalizedQuery)
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (sort === "most-wrong") {
          return (
            right.progress.wrong - left.progress.wrong ||
            right.lastWrongAt.localeCompare(left.lastWrongAt)
          );
        }
        if (sort === "subject") {
          return (
            left.question.subject.localeCompare(right.question.subject, "ko") ||
            right.lastWrongAt.localeCompare(left.lastWrongAt)
          );
        }
        return (
          right.lastWrongAt.localeCompare(left.lastWrongAt) ||
          right.progress.wrong - left.progress.wrong
        );
      });
  }, [minimumWrong, query, sort, status, subject, wrongNotes]);

  const needsReviewCount = wrongNotes.filter((item) => !item.recovered).length;
  const recoveredCount = wrongNotes.length - needsReviewCount;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-7 sm:px-7 lg:py-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="secondary" className="mb-2 rounded-lg">
            한번이라도 틀린 고유 문제
          </Badge>
          <h1 className="text-[clamp(1.8rem,4vw,2.7rem)] font-black tracking-[-0.045em]">
            오답 노트
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            문제를 선택하면 선지와 원문을 열어 한 문제씩 다시 풀 수 있습니다.
          </p>
        </div>
        <Button
          size="lg"
          className="h-12 gap-2 rounded-xl font-black"
          disabled={!filteredNotes.length}
          onClick={() =>
            onStartQuestions(shuffled(filteredNotes.map((item) => item.question.id)))
          }
        >
          <Shuffle className="size-4" /> 현재 목록 무작위로 풀기
        </Button>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold text-muted-foreground">역대 오답</p>
          <p className="mt-1 text-2xl font-black">{wrongNotes.length.toLocaleString()}문제</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
          <p className="text-xs font-bold opacity-70">복습 필요</p>
          <p className="mt-1 text-2xl font-black">{needsReviewCount.toLocaleString()}문제</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="text-xs font-bold opacity-70">다시 맞힘</p>
          <p className="mt-1 text-2xl font-black">{recoveredCount.toLocaleString()}문제</p>
        </div>
      </section>

      <section className="mt-5 rounded-[24px] border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.5fr)_1fr_1fr_1fr_1fr]">
          <label className="relative block">
            <span className="sr-only">문제 내용 검색</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="문제 내용 검색"
              className="h-11 rounded-xl pl-10"
            />
          </label>
          <NativeSelect
            aria-label="과목 선택"
            value={subject}
            onChange={(event) =>
              setFilters((current) => ({ ...current, subject: event.target.value }))
            }
            className="h-11 w-full rounded-xl"
          >
            <NativeSelectOption value="all">전체 과목</NativeSelectOption>
            {bank.subjects.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="최소 오답 횟수"
            value={String(minimumWrong)}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                minimumWrong: Number(event.target.value),
              }))
            }
            className="h-11 w-full rounded-xl"
          >
            {[1, 2, 3, 5, 7, 10].map((count) => (
              <NativeSelectOption key={count} value={count}>
                {count}회 이상 오답
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="복습 상태"
            value={status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value as WrongNoteStatus,
              }))
            }
            className="h-11 w-full rounded-xl"
          >
            <NativeSelectOption value="all">모든 상태</NativeSelectOption>
            <NativeSelectOption value="needs-review">복습 필요</NativeSelectOption>
            <NativeSelectOption value="recovered">다시 맞힘</NativeSelectOption>
          </NativeSelect>
          <NativeSelect
            aria-label="정렬 방식"
            value={sort}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                sort: event.target.value as WrongNoteSort,
              }))
            }
            className="h-11 w-full rounded-xl"
          >
            <NativeSelectOption value="recent">최근에 틀린 순</NativeSelectOption>
            <NativeSelectOption value="most-wrong">많이 틀린 순</NativeSelectOption>
            <NativeSelectOption value="subject">과목 순</NativeSelectOption>
          </NativeSelect>
        </div>
      </section>

      <div className="mt-6 flex items-center justify-between gap-4">
        <h2 className="text-lg font-black">오답 문제 목록</h2>
        <span className="text-sm font-bold text-muted-foreground">
          {filteredNotes.length.toLocaleString()}문제
        </span>
      </div>

      {filteredNotes.length ? (
        <div className="mt-3 grid gap-3">
          {filteredNotes.map(({ clusterId, question, progress: item, recovered, lastWrongAt }) => {
            const stem = cleanDisplayText(question.stem).trim();
            const date = lastWrongAt
              ? new Date(lastWrongAt).toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                })
              : "기록 없음";
            return (
              <button
                key={clusterId}
                type="button"
                onClick={() => onStartQuestions([question.id])}
                className="group w-full rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
              >
                <div className="flex items-start gap-3 sm:gap-4">
                  <span
                    className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl ${
                      recovered
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                    }`}
                  >
                    {recovered ? <Check className="size-5" /> : <RotateCcw className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground">
                      <span>{question.subject}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-rose-600 dark:text-rose-300">
                        누적 오답 {item.wrong}회
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{recovered ? "다시 맞힘" : "복습 필요"}</span>
                    </span>
                    <span className="mt-2 block text-[0.98rem] font-extrabold leading-7 tracking-[-0.015em] sm:text-base">
                      {stem || `제${question.number}번 원문 이미지 문제`}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      최근 오답 {date} · {formatExam(question.examDate, question.round)}
                    </span>
                  </span>
                  <ChevronRight className="mt-2 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-[24px] border border-dashed border-border bg-card px-5 py-14 text-center">
          <BookOpenCheck className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-4 font-black">
            {wrongNotes.length ? "조건에 맞는 오답 문제가 없습니다" : "아직 틀린 문제가 없습니다"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {wrongNotes.length
              ? "검색어나 필터 조건을 바꿔보세요."
              : "문제를 풀다가 틀리면 이곳에 자동으로 기록됩니다."}
          </p>
        </div>
      )}
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
  exitLabel,
}: {
  bank: QuestionBank;
  explanations: ExplanationMap;
  active: ActiveSession;
  setActive: React.Dispatch<React.SetStateAction<ActiveSession | null>>;
  progress: ProgressStore;
  setProgress: React.Dispatch<React.SetStateAction<ProgressStore>>;
  onExit: () => void;
  exitLabel: string;
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
  const isStudyResult = isStudy && active.studyFinished === true;
  const currentAnswer = active.answers[current.id];
  const skippedIds = active.skippedIds ?? [];
  const currentSkipped = skippedIds.includes(current.id);
  const isRevealed = active.gradedIds.includes(current.id) || active.submitted;
  const examScore = active.submitted
    ? questions.filter((question) => active.answers[question.id] === question.answer).length
    : 0;
  const examSkipped = questions.filter((question) => skippedIds.includes(question.id)).length;
  const examUnanswered = questions.filter((question) => !active.answers[question.id]).length;
  const studyAnswered = questions.filter((question) => active.gradedIds.includes(question.id));
  const studyCorrect = studyAnswered.filter(
    (question) => active.answers[question.id] === question.answer,
  );
  const studyWrong = studyAnswered.filter(
    (question) =>
      !skippedIds.includes(question.id) && active.answers[question.id] !== question.answer,
  );
  const studySkipped = studyAnswered.filter((question) => skippedIds.includes(question.id));
  const studyNeedsReview = studyAnswered.filter(
    (question) => active.answers[question.id] !== question.answer,
  );

  function choose(question: Question, answer: number) {
    if (active.submitted || (isStudy && active.gradedIds.includes(question.id))) return;
    setActive((session) => {
      if (!session) return session;
      return {
        ...session,
        answers: { ...session.answers, [question.id]: answer },
        skippedIds: (session.skippedIds ?? []).filter((id) => id !== question.id),
      };
    });
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

  function skipStudyCurrent() {
    if (active.submitted || active.gradedIds.includes(current.id)) return;
    setProgress((store) =>
      recordAttempt(store, current, false, { answerStatus: "unknown" }),
    );
    setActive((session) => {
      if (!session) return session;
      const answers = { ...session.answers };
      delete answers[current.id];
      return {
        ...session,
        answers,
        gradedIds: [...session.gradedIds, current.id],
        skippedIds: [...new Set([...(session.skippedIds ?? []), current.id])],
      };
    });
  }

  function skipExamQuestion(question: Question, advance: boolean) {
    if (active.submitted) return;
    setActive((session) => {
      if (!session) return session;
      const answers = { ...session.answers };
      delete answers[question.id];
      return {
        ...session,
        answers,
        skippedIds: [...new Set([...(session.skippedIds ?? []), question.id])],
      };
    });
    if (advance && active.index < questions.length - 1) move(active.index + 1);
  }

  function submitExam() {
    if (active.submitted) return;
    let nextProgress = progress;
    for (const question of questions) {
      if (!active.answers[question.id] && !skippedIds.includes(question.id)) continue;
      const skipped = skippedIds.includes(question.id);
      nextProgress = recordAttempt(
        nextProgress,
        question,
        !skipped && active.answers[question.id] === question.answer,
        { answerStatus: skipped ? "unknown" : "answered" },
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

  function finishStudy(endedEarly = false) {
    if (!active.gradedIds.length) {
      onExit();
      return;
    }
    setActive((session) =>
      session
        ? { ...session, studyFinished: true, studyEndedEarly: endedEarly }
        : session,
    );
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function requestExit() {
    const shouldShowPartialResult =
      isStudy &&
      !active.studyFinished &&
      active.options.count === "all" &&
      active.gradedIds.length > 0;
    if (shouldShowPartialResult) finishStudy(true);
    else onExit();
  }

  function retryStudyWrong() {
    if (!studyNeedsReview.length) return;
    setActive((session) =>
      session
        ? {
            ...session,
            questionIds: shuffled(studyNeedsReview.map((question) => question.id)),
            index: 0,
            answers: {},
            gradedIds: [],
            skippedIds: [],
            submitted: false,
            studyFinished: false,
            studyEndedEarly: false,
          }
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
          <Button variant="outline" size="sm" className="rounded-xl" onClick={requestExit}>
            <ChevronLeft className="size-4" /> {isStudyResult ? exitLabel : "나가기"}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold text-muted-foreground">
              <span>
                {isStudyResult
                  ? active.studyEndedEarly
                    ? "중단 시점 학습 결과"
                    : "학습 결과"
                  : `${modeMeta.find((mode) => mode.id === active.options.mode)?.label} · ${
                      isStudy ? "학습 모드" : "시험 모드"
                    }`}
              </span>
              <span>
                {isStudyResult
                  ? `${studyAnswered.length}문제 풀이`
                  : `${active.index + 1} / ${questions.length}`}
              </span>
            </div>
            <Progress
              value={
                isStudyResult
                  ? (studyAnswered.length / questions.length) * 100
                  : ((active.index + 1) / questions.length) * 100
              }
              className="h-2"
            />
          </div>
          {!isStudyResult && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-xl md:hidden"
              aria-label="문제 번호 열기"
              onClick={() => setMobileMenu((value) => !value)}
            >
              <Menu className="size-4" />
            </Button>
          )}
        </div>

        {mobileMenu && !isStudyResult && (
          <QuestionNavigator
            questions={questions}
            active={active}
            onMove={move}
            onSubmit={isStudy ? undefined : submitExam}
            className="mb-5 md:hidden"
          />
        )}

        {active.submitted && (
          <section className="mb-6 overflow-hidden rounded-[24px] bg-[#173a6a] p-6 text-white shadow-lg dark:bg-[#102238] sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-blue-200">시험 결과</p>
              <p className="mt-1 text-4xl font-black tracking-[-0.04em]">
                {examScore} / {questions.length}
              </p>
              <p className="mt-2 text-sm text-slate-300">
                정답률 {Math.round((examScore / questions.length) * 100)}% · 모름 {examSkipped}문제
                {examUnanswered > examSkipped
                  ? ` · 미응답 ${examUnanswered - examSkipped}문제`
                  : ""}
                {" · "}아래에서 모든 문제의 정답과 해설을 확인하세요.
              </p>
            </div>
            <Button
              className="mt-5 rounded-xl bg-[#38bdf8] font-black text-[#0c2e4e] hover:bg-[#7dd3fc] sm:mt-0"
              onClick={onExit}
            >
              학습 홈으로
            </Button>
          </section>
        )}

        {isStudyResult ? (
          <StudyResult
            questions={questions}
            answered={studyAnswered}
            correct={studyCorrect}
            wrong={studyWrong}
            skipped={studySkipped}
            needsReview={studyNeedsReview}
            endedEarly={active.studyEndedEarly === true}
            onRetryWrong={retryStudyWrong}
            onExit={onExit}
            exitLabel={exitLabel}
          />
        ) : isStudy ? (
          <StudyQuestion
            question={current}
            index={active.index}
            cluster={cluster}
            explanation={currentExplanation}
            selected={currentAnswer}
            skipped={currentSkipped}
            revealed={isRevealed}
            clipped={currentProgress.clipped}
            wrongCount={currentProgress.wrong}
            onChoose={(answer) => choose(current, answer)}
            onGrade={gradeCurrent}
            onSkip={skipStudyCurrent}
            onClip={() => toggleClip()}
            onNote={() => {
              setNoteDraft(currentProgress.note);
              setNoteOpen(true);
            }}
            onPrevious={() => move(Math.max(0, active.index - 1))}
            onNext={() => {
              if (active.index === questions.length - 1) finishStudy(false);
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
                  skipped={currentSkipped}
                  submitted={active.submitted}
                  explanation={currentExplanation}
                  cluster={cluster}
                  clipped={currentProgress.clipped}
                  onChoose={(answer) => choose(current, answer)}
                  onSkip={() => skipExamQuestion(current, true)}
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
                      skipped={skippedIds.includes(question.id)}
                      submitted={active.submitted}
                      explanation={explanations[question.clusterId]}
                      cluster={clusterById.get(question.clusterId)}
                      clipped={item.clipped}
                      onChoose={(answer) => choose(question, answer)}
                      onSkip={() => skipExamQuestion(question, false)}
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

function StudyResult({
  questions,
  answered,
  correct,
  wrong,
  skipped,
  needsReview,
  endedEarly,
  onRetryWrong,
  onExit,
  exitLabel,
}: {
  questions: Question[];
  answered: Question[];
  correct: Question[];
  wrong: Question[];
  skipped: Question[];
  needsReview: Question[];
  endedEarly: boolean;
  onRetryWrong: () => void;
  onExit: () => void;
  exitLabel: string;
}) {
  const accuracy = answered.length ? Math.round((correct.length / answered.length) * 100) : 0;
  const unanswered = Math.max(0, questions.length - answered.length);

  return (
    <section className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_20px_60px_rgba(16,35,58,.08)]">
      <div className="bg-[#173a6a] px-5 py-8 text-white dark:bg-[#102238] sm:px-8 sm:py-10">
        <Badge className="rounded-lg bg-sky-300 text-[#0c2e4e] hover:bg-sky-300">
          {endedEarly ? "중단 시점 결과" : "학습 완료"}
        </Badge>
        <h2 className="mt-4 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
          정답률 {accuracy}%
        </h2>
        <p className="mt-2 text-sm leading-6 text-blue-100">
          {endedEarly
            ? `현재까지 채점한 ${answered.length}문제만 결과에 반영했습니다. 풀지 않은 문제는 오답으로 처리하지 않습니다.`
            : `${answered.length}문제를 모두 확인했습니다. 틀리거나 모른 문제는 바로 다시 풀 수 있습니다.`}
        </p>
      </div>

      <div className="p-5 sm:p-8">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ResultMetric label="푼 문제" value={answered.length} tone="blue" />
          <ResultMetric label="정답" value={correct.length} tone="green" />
          <ResultMetric label="오답" value={wrong.length} tone="red" />
          <ResultMetric label="모름" value={skipped.length} tone="amber" />
          <ResultMetric label="남은 문제" value={unanswered} tone="slate" />
        </div>

        {needsReview.length ? (
          <div className="mt-7 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-900 dark:bg-rose-950/35 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-rose-950 dark:text-rose-100">
                  다시 확인할 문제
                </h3>
                <p className="mt-1 text-xs text-rose-800/75 dark:text-rose-200/75">
                  틀렸거나 ‘모르겠어요’로 넘긴 문제를 다시 풀 수 있습니다.
                </p>
              </div>
              <Badge variant="destructive" className="shrink-0 rounded-lg">
                {needsReview.length}문제
              </Badge>
            </div>
            <div className="mt-4 divide-y divide-rose-200 dark:divide-rose-900">
              {needsReview.map((question, index) => (
                <div key={question.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-rose-100 text-xs font-black text-rose-800 dark:bg-rose-900 dark:text-rose-100">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <Badge
                      variant="outline"
                      className={`mb-1 rounded-md text-[0.65rem] ${
                        skipped.some((item) => item.id === question.id)
                          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                          : "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100"
                      }`}
                    >
                      {skipped.some((item) => item.id === question.id) ? "모름" : "오답"}
                    </Badge>
                    <p className="text-sm font-bold leading-6">
                      {cleanDisplayText(question.stem)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            <p className="flex items-center gap-2 font-black">
              <Check className="size-5" /> 현재까지 푼 문제를 모두 맞혔습니다.
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" className="rounded-xl" onClick={onExit}>
            {exitLabel === "오답 노트로"
              ? "오답 노트로 돌아가기"
              : exitLabel === "나의 학습으로"
                ? "나의 학습으로 돌아가기"
                : "학습 홈으로"}
          </Button>
          {needsReview.length > 0 && (
            <Button size="lg" className="gap-2 rounded-xl font-black" onClick={onRetryWrong}>
              <RotateCcw className="size-4" /> 틀린·모른 문제 다시 풀기
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function ResultMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "red" | "amber" | "slate";
}) {
  const styles = {
    blue: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    green:
      "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    red: "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100",
    amber:
      "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    slate: "border-border bg-secondary/55 text-foreground",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${styles}`}>
      <p className="text-xs font-bold opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-black">{value.toLocaleString()}</p>
    </div>
  );
}

function StudyQuestion({
  question,
  index,
  cluster,
  explanation,
  selected,
  skipped,
  revealed,
  clipped,
  wrongCount,
  onChoose,
  onGrade,
  onSkip,
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
  skipped: boolean;
  revealed: boolean;
  clipped: boolean;
  wrongCount: number;
  onChoose: (answer: number) => void;
  onGrade: () => void;
  onSkip: () => void;
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
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={onSkip}
                className="gap-2 rounded-xl px-5 font-extrabold"
              >
                <CircleHelp className="size-4" /> 모르겠어요
              </Button>
              <Button
                size="lg"
                disabled={!selected}
                onClick={onGrade}
                className="rounded-xl px-6 font-extrabold"
              >
                정답 확인
              </Button>
            </div>
          ) : (
            <Button size="lg" onClick={onNext} className="gap-2 rounded-xl px-6 font-extrabold">
              {isLast ? "결과 보기" : "다음 문제"} <ChevronRight className="size-4" />
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
          revealed ? "bg-[#eff6ff] dark:bg-[#102a46]" : "bg-secondary/35"
        }`}
      >
        {revealed ? (
          <ExplanationPanel
            question={question}
            explanation={explanation}
            selected={selected}
            skipped={skipped}
          />
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
  skipped,
  submitted,
  explanation,
  cluster,
  clipped,
  onChoose,
  onSkip,
  onClip,
}: {
  question: Question;
  index: number;
  anchorId?: string;
  selected?: number;
  skipped: boolean;
  submitted: boolean;
  explanation?: Explanation;
  cluster?: QuestionBank["clusters"][number];
  clipped: boolean;
  onChoose: (answer: number) => void;
  onSkip: () => void;
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
      {!submitted && (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={skipped}
            onClick={onSkip}
            className={`gap-2 rounded-xl ${
              skipped
                ? "border-amber-300 bg-amber-50 text-amber-900 opacity-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                : ""
            }`}
          >
            <CircleHelp className="size-4" />
            {skipped ? "모름으로 표시됨" : "모르겠어요 · 넘기기"}
          </Button>
        </div>
      )}
      {submitted && (
        <div className="mt-6 rounded-2xl bg-[#eff6ff] p-5 dark:bg-[#102a46]">
          <ExplanationPanel
            question={question}
            explanation={explanation}
            selected={selected}
            skipped={skipped}
            compact
          />
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
          <Badge className="rounded-lg bg-primary text-primary-foreground">{question.subject}</Badge>
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
              ? "border-primary bg-primary text-primary-foreground"
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
      <QuestionSourceAssets question={question} />
    </>
  );
}

function QuestionSourceAssets({ question }: { question: Question }) {
  if (!question.sourceAssets?.length) return null;

  return (
    <figure className="mb-7 rounded-2xl border border-sky-200 bg-white p-3 shadow-sm dark:border-sky-900">
      <figcaption className="mb-3 text-xs font-bold text-slate-600">
        원문 지문·도표
      </figcaption>
      <div className="grid gap-3">
        {question.sourceAssets.map((asset, index) => (
          // The lossless source image must be served as-is instead of being re-encoded.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${question.id}-${asset.sha256}`}
            src={asset.src}
            width={asset.width}
            height={asset.height}
            alt={`원본 PDF의 문항 자료${question.sourceAssets.length > 1 ? ` ${index + 1}` : ""}`}
            loading="lazy"
            className="mx-auto block h-auto max-w-full"
          />
        ))}
      </div>
    </figure>
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
            className={`group flex items-start gap-3 rounded-2xl border p-4 text-left text-[0.9375rem] leading-6 transition-all disabled:cursor-default disabled:opacity-100 ${
              isCorrect
                ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
                : isWrong
                  ? "border-rose-400 bg-rose-50 text-rose-950 dark:bg-rose-950 dark:text-rose-100"
                  : revealed
                    ? "pointer-events-none border-border bg-background text-foreground"
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
  skipped = false,
  compact = false,
}: {
  question: Question;
  explanation?: Explanation;
  selected?: number;
  skipped?: boolean;
  compact?: boolean;
}) {
  const correct = !skipped && selected === question.answer;
  const optionExplanations = question.options.map((option, index) =>
    resolveOptionExplanation(question.id, option, index, explanation),
  );
  const conceptSections = explanation ? parseConceptSections(explanation.concept) : null;
  if (!explanation) {
    return (
      <div className="space-y-5 text-[0.9375rem] leading-7">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-11 place-items-center rounded-full text-white ${
              skipped ? "bg-amber-500" : correct ? "bg-emerald-600" : "bg-rose-500"
            }`}
          >
            {skipped ? (
              <CircleHelp className="size-5" />
            ) : correct ? (
              <Check className="size-5" />
            ) : (
              <X className="size-5" />
            )}
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
            skipped ? "bg-amber-500" : correct ? "bg-emerald-600" : "bg-rose-500"
          }`}
        >
          {skipped ? (
            <CircleHelp className="size-5" />
          ) : correct ? (
            <Check className="size-5" />
          ) : (
            <X className="size-5" />
          )}
        </span>
        <div>
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
            정답 {question.answer}번
          </p>
          <h3 className="text-lg font-black">
            {skipped ? "모르겠어요로 넘긴 문제입니다" : correct ? "정답입니다" : "오답입니다"}
          </h3>
        </div>
      </div>
      <div className="space-y-5 text-[0.9375rem] leading-7">
        <section>
          <h4 className="mb-1 font-extrabold">정답인 이유</h4>
          <p>{explanation.rationale}</p>
        </section>
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-extrabold">선택지별 해설</h4>
            <span className="text-xs font-semibold text-muted-foreground">
              O: 맞는 지문 · X: 틀린 지문
            </span>
          </div>
          <ol className="space-y-2.5">
            {question.options.map((option, index) => (
              <li key={option}>
                <strong
                  className={
                    isOptionStatementTrue(question, index)
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-rose-700 dark:text-rose-300"
                  }
                >
                  {["①", "②", "③", "④"][index]}{" "}
                  {isOptionStatementTrue(question, index) ? "O" : "X"}.
                </strong>{" "}
                {stripOptionVerdict(optionExplanations[index]) || "해설을 검수하고 있습니다."}
              </li>
            ))}
          </ol>
        </section>
        {conceptSections?.core && (
          <section className="rounded-2xl border border-emerald-200 bg-white/70 p-4 dark:border-emerald-900 dark:bg-black/15">
            <h4 className="mb-1 flex items-center gap-2 font-extrabold">
              <CircleAlert className="size-4" /> 핵심 개념
            </h4>
            <p className="whitespace-pre-line">{conceptSections.core}</p>
          </section>
        )}
        {conceptSections && conceptSections.connections.length > 0 && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <h4 className="font-extrabold">함께 구분할 개념</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              정답과 혼동하기 쉽거나 같은 범주에서 함께 출제되는 개념입니다. 이름만 외우지 말고
              아래 차이를 비교해 두세요.
            </p>
            <ul className="mt-3 space-y-2">
              {conceptSections.connections.map((connection) => (
                <li key={connection} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{connection}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function isOptionStatementTrue(question: Question, index: number) {
  const compactStem = cleanDisplayText(question.stem).replace(/\s+/g, "");
  const asksForIncorrect =
    /(옳지않|바르지않|적절하지않|맞지않|잘못|틀린|아닌것|해당하지않|거리가먼|부적합|일치하지않)/.test(
      compactStem,
    );
  return asksForIncorrect ? index + 1 !== question.answer : index + 1 === question.answer;
}

function stripOptionVerdict(value?: string) {
  return String(value ?? "")
    .replace(/^\s*[⭕❌✅○×]\s*/, "")
    .replace(
      /^\s*(?:(?:정답(?!은)|오답|옳음|틀림|맞다|틀리다)(?:\s*기준(?:에\s*부합한다|과\s*어긋난다))?[.!:]?\s*)+/,
      "",
    )
    .replace(/^정답\s+정답은\s*/, "정답은 ")
    .trim();
}

function parseConceptSections(value: string) {
  const normalized = String(value ?? "").replace(/\r/g, "").trim();
  const parts = normalized.split(
    /\n\s*(?:연결 개념|함께 공부할 연결 개념|함께 구분할 개념)\s*\n/i,
  );
  const core = (parts.shift() ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(선택지|핵심 정리|핵심 개념)$/.test(line))
    .join("\n")
    .trim();
  const coreKey = normalizeOptionKey(core);
  const genericConnection =
    /^(정답 개념의 계층과 대표 용도|관련 표준[·ㆍ, ]*전송 매체[·ㆍ, ]*제어 방식|관련 (?:표준|단계).*(?:구조|비교)|정답 개념|혼동 개념|선택지 비교|핵심 정리|정답 선택지\s*[—–:].*)$/;
  const seen = new Set<string>();
  const connections = parts
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter((line) => {
      if (!line || genericConnection.test(line)) return false;
      const key = normalizeOptionKey(line);
      if (!key || seen.has(key) || (coreKey && coreKey.includes(key))) return false;
      const hasExplanation =
        (line.length >= 6 && /[—–:→]/.test(line)) ||
        (line.length >= 12 &&
          /이다|입니다|한다|합니다|사용|역할|기능|계층|주소|방식|구분|위해|제공|프로토콜|표준|장치|번호|전송|관리/.test(
            line,
          )) ||
        (line.length >= 20 && /[.!?]$/.test(line));
      if (!hasExplanation) return false;
      seen.add(key);
      return true;
    });
  return { core, connections };
}

function normalizeOptionKey(value: string) {
  const cleaned = cleanDisplayText(value);
  return cleaned
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "") || cleaned.toLowerCase();
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
  questionId: string,
  option: string,
  index: number,
  explanation?: Explanation,
) {
  if (!explanation) return undefined;
  const occurrenceExplanation = explanation.occurrenceOptionExplanations?.[questionId]?.[index];
  if (occurrenceExplanation) return occurrenceExplanation;
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
          {(active.skippedIds?.length ?? 0) > 0
            ? ` · ${active.skippedIds?.length ?? 0} 모름`
            : ""}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {questions.map((question, index) => {
          const answered = Boolean(active.answers[question.id]);
          const skipped = active.skippedIds?.includes(question.id) ?? false;
          const current = index === active.index;
          const correct =
            active.submitted && active.answers[question.id] === question.answer;
          const wrong =
            active.submitted && !skipped && active.answers[question.id] !== question.answer;
          return (
            <button
              key={question.id}
              aria-label={`${index + 1}번${skipped ? " 모름" : answered ? " 답변 완료" : ""}`}
              onClick={() => onMove(index)}
              className={`aspect-square rounded-lg border text-xs font-black transition-colors ${
                correct
                  ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                  : skipped
                    ? "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                  : wrong
                    ? "border-rose-400 bg-rose-100 text-rose-900"
                    : current
                      ? "border-primary bg-primary text-primary-foreground"
                      : answered
                        ? "border-blue-300 bg-blue-50 text-blue-950"
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
  onOpenWrongNotes,
  onStartQuestion,
  onImportNotion,
  onReset,
}: {
  bank: QuestionBank;
  progress: ProgressStore;
  cloud: ReturnType<typeof useCloudProgress>;
  onOpenWrongNotes: () => void;
  onStartQuestion: (questionId: string) => void;
  onImportNotion: (value: unknown) => NotionWrongImportSummary;
  onReset: () => void | Promise<void>;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<NotionWrongImportSummary | null>(null);
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
  const questionById = new Map(bank.questions.map((question) => [question.id, question]));
  const questionByCluster = new Map(
    bank.clusters.map((cluster) => {
      const item = progress.questions[cluster.id];
      const lastWrongQuestionId = [...(item?.history ?? [])]
        .reverse()
        .find((attempt) => !attempt.correct)?.questionId;
      const latestOccurrence = cluster.occurrenceIds
        .map((id) => questionById.get(id))
        .filter((question): question is Question => Boolean(question))
        .sort(
          (left, right) =>
            right.examDate.localeCompare(left.examDate) || right.number - left.number,
        )[0];
      return [
        cluster.id,
        questionById.get(lastWrongQuestionId ?? "") ??
          latestOccurrence ??
          questionById.get(cluster.representativeId),
      ] as const;
    }),
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
        <div className="flex flex-wrap gap-2">
          <Button className="gap-2 rounded-xl" onClick={onOpenWrongNotes}>
            <RotateCcw className="size-4" /> 오답 노트 열기
          </Button>
          <Button
            variant="outline"
            className="gap-2 rounded-xl"
            onClick={() => {
              setImportError("");
              setImportResult(null);
              setImportOpen(true);
            }}
          >
            <FileUp className="size-4" /> Notion 오답 가져오기
          </Button>
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
            <span className="grid size-11 place-items-center rounded-xl bg-blue-100 text-blue-950 dark:bg-blue-950 dark:text-blue-100">
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
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-black">자주 틀린 문제</h2>
          <span className="text-xs font-semibold text-muted-foreground">
            문제를 선택하면 바로 다시 풀 수 있습니다.
          </span>
        </div>
        {hardest.length ? (
          <div className="mt-4 divide-y divide-border">
            {hardest.map(([clusterId, item]) => {
              const question = questionByCluster.get(clusterId);
              return (
                <button
                  key={clusterId}
                  type="button"
                  disabled={!question}
                  onClick={() => question && onStartQuestion(question.id)}
                  className="group flex w-full items-start gap-4 rounded-xl px-2 py-4 text-left transition-colors first:pt-0 last:pb-0 hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <Badge variant="destructive" className="mt-0.5 shrink-0 rounded-lg">
                    {item.wrong}회
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-bold leading-6">
                      {question ? cleanDisplayText(question.stem) : clusterId}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {question?.subject} · {item.attempts}회 풀이
                    </p>
                  </div>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyMini text="아직 틀린 문제가 없습니다." />
        )}
      </section>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notion 오답 기록 가져오기</DialogTitle>
            <DialogDescription>
              자격증 메모 DB에서 만든 전용 JSON 파일을 선택합니다. 실제 오답과 미응답을
              구분해 기존 학습 기록에 합치며, 같은 기록은 다시 추가하지 않습니다.
            </DialogDescription>
          </DialogHeader>

          <label
            className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-5 text-center transition-colors hover:bg-primary/10 ${
              importBusy ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {importBusy ? (
              <LoaderCircle className="size-7 animate-spin text-primary" />
            ) : (
              <FileUp className="size-7 text-primary" />
            )}
            <span className="mt-3 font-extrabold">
              {importBusy ? "기록을 확인하고 있습니다" : "JSON 파일 선택"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              가져온 기록은 이 기기에 저장되고, 로그인 상태에서는 클라우드에도 동기화됩니다.
            </span>
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setImportBusy(true);
                setImportError("");
                setImportResult(null);
                try {
                  const value = JSON.parse(await file.text()) as unknown;
                  setImportResult(onImportNotion(value));
                } catch (error) {
                  setImportError(
                    error instanceof Error ? error.message : "파일을 가져오지 못했습니다.",
                  );
                } finally {
                  setImportBusy(false);
                  input.value = "";
                }
              }}
            />
          </label>

          {importResult && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              <p className="font-black">{importResult.imported}회 기록을 가져왔습니다.</p>
              <p className="mt-1 leading-6 opacity-85">
                실제 오답 {importResult.wrong}회 · 미응답/모름 {importResult.missed}회
                {importResult.duplicates ? ` · 이미 있던 기록 ${importResult.duplicates}회 제외` : ""}
                {importResult.unmatched.length
                  ? ` · 연결하지 못한 기록 ${importResult.unmatched.length}회`
                  : ""}
              </p>
            </div>
          )}
          {importError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-950 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
              {importError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
