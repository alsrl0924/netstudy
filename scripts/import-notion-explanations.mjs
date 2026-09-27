import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sourceDir = path.join(root, "tmp", "notion-pages");
const bankPath = path.join(root, "public", "data", "question-bank.json");
const outputPath = path.join(root, "public", "data", "explanations.json");

const bank = JSON.parse(await readFile(bankPath, "utf8"));
const questionById = new Map(bank.questions.map((question) => [question.id, question]));
const gradeByCluster = new Map();

function normalizeFetchedText(value) {
  return value
    .replace(/\\</g, "<")
    .replace(/\\>/g, ">")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/\r\n/g, "\n");
}

function plain(value) {
  return value
    .replace(/<\/?(?:callout|details|summary)[^>]*>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\\([*_`])/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function normalizeKey(value) {
  return plain(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function firstBoundary(text, start, markers) {
  const indexes = markers
    .map((marker) => text.indexOf(marker, start))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : text.length;
}

function extractRationale(section) {
  const marker = "**정답 근거**";
  const start = section.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const end = firstBoundary(section, bodyStart, [
    "<details",
    "<callout",
    "### ",
    "</details>",
  ]);
  return plain(section.slice(bodyStart, end));
}

function extractOptionBlock(section) {
  const marker = "<summary>🔎 선택지별 상세 해설</summary>";
  const start = section.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const end = section.indexOf("</details>", bodyStart);
  return section.slice(bodyStart, end < 0 ? section.length : end);
}

function extractOptionDetails(section, sourceOptions) {
  const block = extractOptionBlock(section);
  if (!block) return [];

  const rows = [];
  let current = null;
  for (const originalLine of block.split("\n")) {
    const line = originalLine.trim();
    if (!line || /^<\/?(?:details|callout)/.test(line)) continue;

    const numbered = line.match(/^([1-4])번\s*[⭕❌✅]?\s*(.+)$/);
    if (numbered) {
      current = {
        index: Number(numbered[1]) - 1,
        label: sourceOptions[Number(numbered[1]) - 1] ?? "",
        explanation: plain(numbered[2]),
      };
      rows.push(current);
      continue;
    }

    if (line.startsWith("- ")) {
      const body = line.slice(2).trim();
      const boldMatch = body.match(/^\*\*(.*?)\*\*\s*(?:—|-)?\s*(.*)$/);
      const rawLabel = boldMatch ? boldMatch[1] : body.split(/\s+—\s+/)[0];
      const afterLabel = boldMatch
        ? boldMatch[2]
        : body.includes(" — ")
          ? body.slice(body.indexOf(" — ") + 3)
          : "";
      const indexMatch = rawLabel.match(/^([1-4])(?:️⃣|번)?\s*(.*)$/);
      const index = indexMatch ? Number(indexMatch[1]) - 1 : rows.length;
      const labelFromLine = indexMatch ? indexMatch[2] : rawLabel;
      current = {
        index,
        label: sourceOptions[index] ?? plain(labelFromLine),
        explanation: plain(afterLabel),
      };
      rows.push(current);
      continue;
    }

    if (current) {
      const continuation = plain(line);
      if (continuation) {
        current.explanation = `${current.explanation} ${continuation}`.trim();
      }
    }
  }

  return rows
    .sort((left, right) => left.index - right.index)
    .slice(0, 4)
    .map((row, index) => ({
      option: row.label || sourceOptions[index] || "",
      explanation: row.explanation,
    }));
}

function extractDetailsSummary(section, summary) {
  const marker = `<summary>${summary}</summary>`;
  const start = section.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const end = section.indexOf("</details>", bodyStart);
  return section.slice(bodyStart, end < 0 ? section.length : end);
}

function extractHeadingSection(section, heading, followingHeadings) {
  const marker = `### ${heading}`;
  const start = section.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const markers = followingHeadings.map((item) => `### ${item}`).concat(["</details>"]);
  const end = firstBoundary(section, bodyStart, markers);
  return section.slice(bodyStart, end);
}

function cleanConcept(value, rationale) {
  if (!value) return "";
  const prepared = value
    .replace(/<tr[^>]*>/g, "\n")
    .replace(/<\/tr>/g, "\n")
    .replace(/<td[^>]*>/g, "")
    .replace(/<\/td>/g, " · ")
    .replace(/<table[^>]*>|<\/table>/g, "\n")
    .replace(/<callout[^>]*>|<\/callout>/g, "\n");

  const rationaleKey = normalizeKey(rationale);
  const seen = new Set();
  const lines = [];
  for (const sourceLine of prepared.split("\n")) {
    let line = plain(sourceLine)
      .replace(/^[-•]\s*/, "• ")
      .replace(/\s*·\s*$/, "")
      .trim();
    if (!line) continue;
    if (/^(정답이 되는 이유|핵심 개념 완성 정리|함께 공부할 연결 개념|구분|학습 내용|내용|정답 기준|핵심 원리|구분 기준|판별 단서|함께 구분할 것|자주 틀리는 함정)$/.test(line)) continue;
    const key = normalizeKey(line);
    if (!key || key === rationaleKey || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n");
}

function findClusterId(section) {
  const counts = new Map();
  for (const match of section.matchAll(/(\d{4})-(\d{2})-(\d{2})[^\n]*?Q(\d+)/g)) {
    const occurrenceId = `${match[1]}${match[2]}${match[3]}-q${String(match[4]).padStart(2, "0")}`;
    const clusterId = questionById.get(occurrenceId)?.clusterId;
    if (clusterId) counts.set(clusterId, (counts.get(clusterId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function parsePage(raw, fileName) {
  const text = normalizeFetchedText(raw);
  const matches = [...text.matchAll(/^#### Q(\d+)\. (.+)$/gm)];
  return matches.map((match, index) => {
    const section = text.slice(match.index, matches[index + 1]?.index ?? text.length);
    const clusterId = findClusterId(section);
    if (!clusterId) throw new Error(`${fileName} Q${match[1]}: 출제 이력으로 문항을 찾지 못했습니다.`);
    const sourceGrade = section.match(/빈출등급 ([SABC])/)?.[1];
    if (!sourceGrade) throw new Error(`${fileName} Q${match[1]}: 빈출등급을 찾지 못했습니다.`);
    gradeByCluster.set(clusterId, sourceGrade);

    const answerStart = section.indexOf("<summary>✅ 정답 · 상세 해설</summary>");
    const questionPart = section.slice(0, answerStart < 0 ? section.length : answerStart);
    const sourceOptions = [...questionPart.matchAll(/^([1-4])️⃣\s+(.+)$/gm)]
      .sort((left, right) => Number(left[1]) - Number(right[1]))
      .map((item) => plain(item[2]));
    const representative = bank.questions.find(
      (question) => question.id === bank.clusters.find((cluster) => cluster.id === clusterId)?.representativeId,
    );
    const options = sourceOptions.length === 4 ? sourceOptions : representative?.options ?? [];
    const answerMatch = section.match(/정답\s*([1-4])번/);
    const answer = Number(answerMatch?.[1] ?? representative?.answer ?? 0);
    const rationale = extractRationale(section);
    const optionDetails = extractOptionDetails(section, options);

    const richConcept = extractDetailsSummary(section, "📘 핵심 개념 완성 정리");
    const simpleConcept = extractHeadingSection(section, "📘 핵심 개념 완성 정리", [
      "🧪 새 문제 대비 · 이렇게 바뀌어도 풀기",
      "🧠 암기 문장",
      "🔗 함께 공부할 연결 개념",
    ]);
    const richConnections = extractDetailsSummary(section, "🔗 함께 공부할 연결 개념");
    const simpleConnections = extractHeadingSection(section, "🔗 함께 공부할 연결 개념", []);
    const concept = cleanConcept(richConcept || simpleConcept, rationale);
    const connections = cleanConcept(richConnections || simpleConnections, rationale);
    const combinedConcept = [
      concept,
      connections ? `연결 개념\n${connections}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return [clusterId, {
      title: `${plain(match[2])}`,
      rationale,
      optionExplanations: optionDetails.map((item) => item.explanation),
      optionDetails,
      concept: combinedConcept,
      sourceNote: `Notion 상세 해설 원문 이관 · ${fileName.replace(/\.md$/, "")}`,
      answer,
    }];
  });
}

const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".md")).sort();
const explanations = {};
for (const file of files) {
  const entries = parsePage(await readFile(path.join(sourceDir, file), "utf8"), file);
  for (const [clusterId, explanation] of entries) {
    if (explanations[clusterId]) throw new Error(`${clusterId}: 해설이 중복되었습니다.`);
    explanations[clusterId] = explanation;
  }
}

const audit = {
  pages: files.length,
  explanations: Object.keys(explanations).length,
  missingRationale: Object.values(explanations).filter((item) => !item.rationale).length,
  incompleteOptions: Object.values(explanations).filter((item) => item.optionDetails.length !== 4).length,
  missingConcept: Object.values(explanations).filter((item) => !item.concept).length,
};

if (audit.pages !== 29 || audit.explanations !== 1197) {
  throw new Error(`해설 수 검증 실패: ${JSON.stringify(audit)}`);
}

for (const cluster of bank.clusters) {
  cluster.grade = gradeByCluster.get(cluster.id) ?? "C";
}
const gradeCounts = Object.fromEntries(
  ["S", "A", "B", "C"].map((grade) => [
    grade,
    bank.clusters.filter((cluster) => cluster.grade === grade).length,
  ]),
);
if (
  gradeCounts.S !== 222 ||
  gradeCounts.A !== 298 ||
  gradeCounts.B !== 677 ||
  gradeCounts.C !== 840
) {
  throw new Error(`빈출등급 검증 실패: ${JSON.stringify(gradeCounts)}`);
}

await writeFile(bankPath, JSON.stringify(bank), "utf8");
await writeFile(outputPath, JSON.stringify(explanations), "utf8");
console.log(JSON.stringify({ output: outputPath, ...audit }, null, 2));
