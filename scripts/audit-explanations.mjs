import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bank = JSON.parse(await readFile(path.join(root, "public", "data", "question-bank.json"), "utf8"));
const explanations = JSON.parse(
  await readFile(path.join(root, "public", "data", "explanations.json"), "utf8"),
);

const forbidden = [
  /\bundefined\b/i,
  /\bnull\b/i,
  /지문이 누락/,
  /원본 PDF (?:확인|대조)/,
  /현재 설명 지문/,
  /현재 페이지에는/,
  /해설을 검수하고 있습니다/,
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function optionSimilarity(left, right) {
  const a = normalize(left) || String(left ?? "").trim().toLowerCase();
  const b = normalize(right) || String(right ?? "").trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const pairs = (value) => {
    const result = new Map();
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

const clusters = new Map(bank.clusters.map((cluster) => [cluster.id, cluster]));
const questionsByCluster = new Map();
for (const question of bank.questions) {
  const questions = questionsByCluster.get(question.clusterId) ?? [];
  questions.push(question);
  questionsByCluster.set(question.clusterId, questions);
}

const errors = [];
const warnings = [];
const detailedGrades = new Set(["S", "A", "B"]);
const detailedClusters = bank.clusters.filter((cluster) => detailedGrades.has(cluster.grade));

for (const cluster of detailedClusters) {
  if (!explanations[cluster.id]) {
    errors.push({ clusterId: cluster.id, type: "missing-explanation" });
  }
}

for (const [clusterId, explanation] of Object.entries(explanations)) {
  const cluster = clusters.get(clusterId);
  if (!cluster) {
    errors.push({ clusterId, type: "unknown-cluster" });
    continue;
  }
  const serialized = JSON.stringify(explanation);
  const forbiddenPattern = forbidden.find((pattern) => pattern.test(serialized));
  if (forbiddenPattern) {
    errors.push({ clusterId, type: "forbidden-placeholder", pattern: String(forbiddenPattern) });
  }
  for (const field of ["title", "rationale", "concept"]) {
    if (!String(explanation[field] ?? "").trim()) {
      errors.push({ clusterId, type: "empty-field", field });
    }
  }
  if (!Array.isArray(explanation.optionExplanations) || explanation.optionExplanations.length !== 4) {
    errors.push({ clusterId, type: "option-explanation-count", found: explanation.optionExplanations?.length });
  }
  if (!Array.isArray(explanation.optionDetails) || explanation.optionDetails.length < 4) {
    errors.push({ clusterId, type: "option-detail-count", found: explanation.optionDetails?.length });
    continue;
  }
  explanation.optionDetails.forEach((detail, index) => {
    if (!String(detail.option ?? "").trim() || !String(detail.explanation ?? "").trim()) {
      errors.push({ clusterId, type: "empty-option-detail", index: index + 1 });
    }
  });
  for (const question of questionsByCluster.get(clusterId) ?? []) {
    const occurrenceExplanations = explanation.occurrenceOptionExplanations?.[question.id];
    if (!Array.isArray(occurrenceExplanations) || occurrenceExplanations.length !== 4) {
      errors.push({
        clusterId,
        questionId: question.id,
        type: "occurrence-option-explanation-count",
        found: occurrenceExplanations?.length,
      });
      continue;
    }
    occurrenceExplanations.forEach((text, index) => {
      if (normalize(text).length < 20) {
        errors.push({
          clusterId,
          questionId: question.id,
          type: "short-occurrence-option-explanation",
          option: index + 1,
          length: normalize(text).length,
        });
      }
      if (/[⭕❌✅]/.test(text) || /정답 기준(?:과 어긋난다|에 부합한다)/.test(text)) {
        errors.push({
          clusterId,
          questionId: question.id,
          type: "status-marker-in-occurrence-explanation",
          option: index + 1,
        });
      }
    });
    question.options.forEach((option, index) => {
      const best = Math.max(
        ...explanation.optionDetails.map((detail) => optionSimilarity(option, detail.option)),
      );
      if (best < 0.28) {
        errors.push({
          clusterId,
          questionId: question.id,
          type: "unmatched-option",
          option: index + 1,
          text: option,
          bestScore: Number(best.toFixed(3)),
        });
      }
    });
  }
  const rationaleLength = normalize(explanation.rationale).length;
  const conceptLength = normalize(explanation.concept).length;
  const shortestOption = Math.min(
    ...explanation.optionDetails.map((detail) => normalize(detail.explanation).length),
  );
  if (rationaleLength < 35) warnings.push({ clusterId, type: "concise-rationale", length: rationaleLength });
  if (conceptLength < 70) warnings.push({ clusterId, type: "concise-concept", length: conceptLength });
  if (shortestOption < 20) warnings.push({ clusterId, type: "concise-option", length: shortestOption });
  const connectionSection = String(explanation.concept).split(/\n\s*연결 개념\s*\n/)[1];
  if (connectionSection) {
    const connectionLines = connectionSection
      .split("\n")
      .map((line) => line.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean);
    connectionLines.forEach((line, index) => {
      const generic =
        /^(정답 개념의 계층과 대표 용도|관련 표준[·ㆍ, ]*전송 매체[·ㆍ, ]*제어 방식|관련 (?:표준|단계).*(?:구조|비교)|정답 개념|혼동 개념|선택지 비교|핵심 정리|정답 선택지\s*[—–:].*)$/.test(
          line,
        );
      const meaningful =
        (line.length >= 6 && /[—–:→]/.test(line)) ||
        (line.length >= 12 &&
          /이다|입니다|한다|합니다|사용|역할|기능|계층|주소|방식|구분|위해|제공|프로토콜|표준|장치|번호|전송|관리/.test(
            line,
          )) ||
        (line.length >= 20 && /[.!?]$/.test(line));
      if (generic || !meaningful) {
        errors.push({ clusterId, type: "unexplained-related-concept", index: index + 1, text: line });
      }
    });
  }
}

const audit = {
  explanationCount: Object.keys(explanations).length,
  expectedDetailedClusterCount: detailedClusters.length,
  checkedQuestionOccurrences: [...questionsByCluster.entries()]
    .filter(([clusterId]) => explanations[clusterId])
    .reduce((count, [, questions]) => count + questions.length, 0),
  errors: errors.length,
  warnings: warnings.length,
  warningTypes: Object.fromEntries(
    [...new Set(warnings.map((warning) => warning.type))].map((type) => [
      type,
      warnings.filter((warning) => warning.type === type).length,
    ]),
  ),
};

const reportPath = path.join(root, "tmp", "explanation-audit.json");
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ summary: audit, errors, warnings }, null, 2), "utf8");
console.log(JSON.stringify(audit, null, 2));
if (errors.length) {
  console.error(JSON.stringify(errors.slice(0, 100), null, 2));
  process.exitCode = 1;
}
