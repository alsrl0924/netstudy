export type Question = {
  id: string;
  clusterId: string;
  examDate: string;
  year: number;
  round: number;
  number: number;
  subject: string;
  stem: string;
  options: string[];
  answer: number;
  sourceFile: string;
  sourceAssets: Array<{
    src: string;
    width: number;
    height: number;
    sha256: string;
    sourceFile: string;
    page: number;
    sourceObject: string;
  }>;
};

export type QuestionCluster = {
  id: string;
  subject: string;
  representativeId: string;
  occurrenceIds: string[];
  totalCount: number;
  recentFiveCount: number;
  firstSeen: string;
  lastSeen: string;
  grade: "S" | "A" | "B" | "C";
  frequencyScore: number;
};

export type Exam = {
  date: string;
  year: number;
  round: number;
  questionIds: string[];
};

export type QuestionBank = {
  meta: {
    generatedAt: string;
    sourcePdfCount: number;
    questionCount: number;
    uniqueQuestionCount: number;
    examCount: number;
    firstYear: number;
    latestYear: number;
    sourceAssetQuestionCount: number;
    sourceAssetCount: number;
  };
  subjects: string[];
  exams: Exam[];
  clusters: QuestionCluster[];
  questions: Question[];
};

export type Explanation = {
  title: string;
  rationale: string;
  optionExplanations: string[];
  optionDetails?: Array<{ option: string; explanation: string }>;
  occurrenceOptionExplanations?: Record<string, string[]>;
  concept: string;
  sourceNote?: string;
};

export type ExplanationMap = Record<string, Explanation>;

export type QuestionProgress = {
  attempts: number;
  correct: number;
  wrong: number;
  clipped: boolean;
  note: string;
  lastAnsweredAt?: string;
  stateUpdatedAt?: string;
  history: Array<{
    id: string;
    at: string;
    correct: boolean;
    subject: string;
    topic: string;
  }>;
};

export type ProgressStore = {
  version: 1;
  questions: Record<string, QuestionProgress>;
  preferences: {
    dark: boolean;
    fontScale: "normal" | "large" | "xlarge";
  };
  preferencesUpdatedAt?: string;
};

export type PracticeMode = "round" | "wrong" | "clips" | "random" | "frequent";
export type SessionType = "study" | "exam";
export type YearRange = "3" | "5" | "all";
export type QuestionCount = "5" | "10" | "25" | "50" | "all";

export type SessionOptions = {
  mode: PracticeMode;
  type: SessionType;
  yearRange: YearRange;
  subject: string;
  count: QuestionCount;
  examDate: string;
  minimumWrong: number;
};

export const EMPTY_STORE: ProgressStore = {
  version: 1,
  questions: {},
  preferences: {
    dark: false,
    fontScale: "normal",
  },
};

export const STORAGE_KEY = "network-manager-study-progress-v2";
export const SESSION_KEY = "network-manager-active-session-v2";

export function loadProgress(): ProgressStore {
  if (typeof window === "undefined") return EMPTY_STORE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(EMPTY_STORE);
    return normalizeProgress(JSON.parse(saved));
  } catch {
    return structuredClone(EMPTY_STORE);
  }
}

export function saveProgress(store: ProgressStore) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }
}

export function emptyQuestionProgress(): QuestionProgress {
  return {
    attempts: 0,
    correct: 0,
    wrong: 0,
    clipped: false,
    note: "",
    history: [],
  };
}

export function recordAttempt(
  store: ProgressStore,
  question: Question,
  correct: boolean,
): ProgressStore {
  const current = store.questions[question.clusterId] ?? emptyQuestionProgress();
  const now = new Date().toISOString();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`;
  return {
    ...store,
    questions: {
      ...store.questions,
      [question.clusterId]: {
        ...current,
        attempts: current.attempts + 1,
        correct: current.correct + (correct ? 1 : 0),
        wrong: current.wrong + (correct ? 0 : 1),
        lastAnsweredAt: now,
        history: [
          ...current.history,
          {
            id,
            at: now,
            correct,
            subject: question.subject,
            topic: inferTopic(question),
          },
        ].slice(-500),
      },
    },
  };
}

export function normalizeProgress(value: unknown): ProgressStore {
  const candidate = value && typeof value === "object" ? (value as Partial<ProgressStore>) : {};
  const questions = Object.fromEntries(
    Object.entries(candidate.questions ?? {}).map(([clusterId, item]) => {
      const history = Array.isArray(item.history)
        ? item.history.map((entry, index) => ({
            ...entry,
            id:
              entry.id ??
              `${clusterId}:${entry.at}:${entry.correct ? 1 : 0}:${entry.subject}:${entry.topic}:${index}`,
          }))
        : [];
      return [
        clusterId,
        {
          ...emptyQuestionProgress(),
          ...item,
          history,
        } satisfies QuestionProgress,
      ];
    }),
  );

  return {
    ...structuredClone(EMPTY_STORE),
    ...candidate,
    version: 1,
    questions,
    preferences: { ...EMPTY_STORE.preferences, ...candidate.preferences },
  };
}

export function mergeProgress(localValue: unknown, remoteValue: unknown): ProgressStore {
  const local = normalizeProgress(localValue);
  const remote = normalizeProgress(remoteValue);
  const questions: Record<string, QuestionProgress> = {};
  const clusterIds = new Set([
    ...Object.keys(local.questions),
    ...Object.keys(remote.questions),
  ]);

  for (const clusterId of clusterIds) {
    const localItem = local.questions[clusterId] ?? emptyQuestionProgress();
    const remoteItem = remote.questions[clusterId] ?? emptyQuestionProgress();
    const history = [...localItem.history, ...remoteItem.history]
      .filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.id === entry.id) === index,
      )
      .sort((left, right) => left.at.localeCompare(right.at))
      .slice(-500);

    const localStateTime = localItem.stateUpdatedAt ?? "";
    const remoteStateTime = remoteItem.stateUpdatedAt ?? "";
    const stateSource =
      localStateTime || remoteStateTime
        ? localStateTime >= remoteStateTime
          ? localItem
          : remoteItem
        : localItem.clipped || localItem.note
          ? localItem
          : remoteItem;
    const historyCorrect = history.filter((entry) => entry.correct).length;
    const historyWrong = history.length - historyCorrect;

    questions[clusterId] = {
      attempts: history.length || Math.max(localItem.attempts, remoteItem.attempts),
      correct: history.length ? historyCorrect : Math.max(localItem.correct, remoteItem.correct),
      wrong: history.length ? historyWrong : Math.max(localItem.wrong, remoteItem.wrong),
      clipped: stateSource.clipped,
      note: stateSource.note,
      stateUpdatedAt: stateSource.stateUpdatedAt,
      lastAnsweredAt: [localItem.lastAnsweredAt, remoteItem.lastAnsweredAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
      history,
    };
  }

  const preferencesSource =
    (local.preferencesUpdatedAt ?? "") >= (remote.preferencesUpdatedAt ?? "")
      ? local
      : remote;

  return {
    version: 1,
    questions,
    preferences: preferencesSource.preferences,
    preferencesUpdatedAt: preferencesSource.preferencesUpdatedAt,
  };
}

export function inferTopic(question: Question): string {
  const text = `${question.stem} ${question.options.join(" ")}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/\barp\b|주소 결정/, "ARP"],
    [/\bdns\b|도메인 네임/, "DNS"],
    [/\bdhcp\b/, "DHCP"],
    [/ipv6|ip v6/, "IPv6"],
    [/서브넷|subnet|cidr/, "서브넷팅"],
    [/tcp|udp|포트 번호|port/, "TCP·UDP"],
    [/icmp|ping|tracert|traceroute/, "ICMP·진단"],
    [/라우팅|router|rip|ospf|bgp/, "라우팅"],
    [/osi|계층|layer/, "OSI 계층"],
    [/ethernet|이더넷|mac 주소/, "이더넷"],
    [/무선|802\.11|wi-?fi|wpa|ssid/, "무선 네트워크"],
    [/linux|리눅스|chmod|cron|bash/, "Linux"],
    [/windows|윈도우|active directory|iis|ntfs/, "Windows Server"],
    [/raid|디스크|파일 시스템/, "저장장치·RAID"],
    [/보안|암호|방화벽|침입|dos|ddos|vpn/, "네트워크 보안"],
    [/케이블|광섬유|utp|stp|rj-45/, "전송 매체"],
    [/스위치|허브|브리지|vlan/, "스위칭·LAN"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? question.subject.replace(/^\d과목\s*/, "");
}

export function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function formatExam(date: string, round: number) {
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  const day = date.slice(8, 10);
  return `${year}년 정기 제${String(round).padStart(2, "0")}회 · ${month}.${day}`;
}

export function cleanDisplayText(text: string) {
  return text.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function yearStart(latestYear: number, range: YearRange) {
  if (range === "all") return 0;
  return latestYear - Number(range) + 1;
}
