import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bank = JSON.parse(await readFile(path.join(root, "public", "data", "question-bank.json"), "utf8"));
const explanations = JSON.parse(
  await readFile(path.join(root, "public", "data", "explanations.json"), "utf8"),
);

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[①②③④⭕❌✅]/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");

const genericPatterns = [
  ["condition-fallback", /문제에서 요구한 조건에 해당하지 않습니다/],
  ["answer-repeat-fallback", /정답 선택지는/],
  ["definition-layer-fallback", /핵심 정의[·ㆍ]계층[·ㆍ]규격과 대조/],
  ["teacher-answer-fallback", /교사용 정답(?:은|에)/],
];

const issues = [];
const questionsByCluster = new Map();
for (const question of bank.questions) {
  const list = questionsByCluster.get(question.clusterId) ?? [];
  list.push(question);
  questionsByCluster.set(question.clusterId, list);
}

for (const cluster of bank.clusters) {
  const explanation = explanations[cluster.id];
  if (!explanation) {
    issues.push({ clusterId: cluster.id, grade: cluster.grade, type: "missing-detailed-explanation" });
    continue;
  }

  const serialized = JSON.stringify(explanation);
  for (const [type, pattern] of genericPatterns) {
    if (pattern.test(serialized)) issues.push({ clusterId: cluster.id, grade: cluster.grade, type });
  }

  const representativeOptions = (explanation.optionExplanations ?? []).map(normalize).filter(Boolean);
  if (new Set(representativeOptions).size < representativeOptions.length) {
    issues.push({ clusterId: cluster.id, grade: cluster.grade, type: "duplicate-option-explanation" });
  }

  for (const question of questionsByCluster.get(cluster.id) ?? []) {
    const occurrence = explanation.occurrenceOptionExplanations?.[question.id] ?? [];
    const normalized = occurrence.map(normalize).filter(Boolean);
    if (normalized.length !== 4) {
      issues.push({
        clusterId: cluster.id,
        questionId: question.id,
        grade: cluster.grade,
        type: "incomplete-occurrence-explanation",
      });
    } else if (new Set(normalized).size < normalized.length) {
      issues.push({
        clusterId: cluster.id,
        questionId: question.id,
        grade: cluster.grade,
        type: "duplicate-occurrence-explanation",
      });
    }
  }
}

for (const question of bank.questions) {
  if (question.options?.length !== 4) {
    issues.push({ questionId: question.id, type: "invalid-option-count", found: question.options?.length });
  }
  if (![1, 2, 3, 4].includes(question.answer)) {
    issues.push({ questionId: question.id, type: "invalid-answer", found: question.answer });
  }
  for (const asset of question.sourceAssets ?? []) {
    const relative = String(asset.src).replace(/^\.\//, "");
    try {
      const info = await stat(path.join(root, "public", relative));
      if (!info.isFile() || info.size === 0) throw new Error("empty");
    } catch {
      issues.push({ questionId: question.id, type: "missing-source-asset", src: asset.src });
    }
  }
}

const issueCounts = Object.fromEntries(
  [...new Set(issues.map((issue) => issue.type))]
    .sort()
    .map((type) => [type, issues.filter((issue) => issue.type === type).length]),
);
const issueCountsByGrade = Object.fromEntries(
  ["S", "A", "B", "C"].map((grade) => [
    grade,
    Object.fromEntries(
      [...new Set(issues.filter((issue) => issue.grade === grade).map((issue) => issue.type))]
        .sort()
        .map((type) => [
          type,
          issues.filter((issue) => issue.grade === grade && issue.type === type).length,
        ]),
    ),
  ]),
);
const affectedClusters = new Set(issues.map((issue) => issue.clusterId).filter(Boolean));
const affectedQuestions = new Set(issues.map((issue) => issue.questionId).filter(Boolean));
const gradeCounts = Object.fromEntries(
  ["S", "A", "B", "C"].map((grade) => [
    grade,
    bank.clusters.filter((cluster) => cluster.grade === grade).length,
  ]),
);

const summary = {
  questionCount: bank.questions.length,
  clusterCount: bank.clusters.length,
  gradeCounts,
  detailedExplanationCount: Object.keys(explanations).length,
  sourceAssetQuestionCount: bank.questions.filter((question) => question.sourceAssets?.length).length,
  affectedClusterCount: affectedClusters.size,
  affectedQuestionCount: affectedQuestions.size,
  totalIssueCount: issues.length,
  issueCounts,
  issueCountsByGrade,
};

const reportPath = path.join(root, "tmp", "question-quality-audit.json");
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ summary, issues }, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));

if (process.argv.includes("--strict") && issues.length) process.exitCode = 1;
