import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sourceDir = path.join(root, "tmp", "notion-pages");
const bankPath = path.join(root, "public", "data", "question-bank.json");
const outputPath = path.join(root, "public", "data", "explanations.json");
const overridePath = path.join(root, "source-data", "explanation-overrides.json");

const bank = JSON.parse(await readFile(bankPath, "utf8"));
const explanationOverrides = JSON.parse(await readFile(overridePath, "utf8"));
const questionById = new Map(bank.questions.map((question) => [question.id, question]));
const clusterById = new Map(bank.clusters.map((cluster) => [cluster.id, cluster]));
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

function optionSimilarity(left, right) {
  const a = normalizeKey(left) || plain(String(left ?? "")).toLowerCase();
  const b = normalizeKey(right) || plain(String(right ?? "")).toLowerCase();
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
        label: indexMatch
          ? sourceOptions[index] ?? plain(labelFromLine)
          : plain(labelFromLine) || sourceOptions[index] || "",
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
    if (/^(undefined|null|none|n\/a|-+)$/i.test(line)) continue;
    const key = normalizeKey(line);
    if (!key || key === rationaleKey || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n");
}

function cleanConnections(value, concept, rationale) {
  const cleaned = cleanConcept(value, rationale);
  const conceptKey = normalizeKey(concept);
  const seen = new Set();
  return cleaned
    .split("\n")
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter((line) => {
      if (!line) return false;
      if (
        /^(정답 개념의 계층과 대표 용도|관련 표준[·ㆍ, ]*전송 매체[·ㆍ, ]*제어 방식|관련 (?:표준|단계).*(?:구조|비교)|정답 개념|혼동 개념|선택지 비교|핵심 정리|정답 선택지\s*[—–:].*)$/.test(
          line,
        )
      ) {
        return false;
      }
      const key = normalizeKey(line);
      if (!key || seen.has(key) || (conceptKey && conceptKey.includes(key))) return false;
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
    })
    .map((line) => `• ${line}`)
    .join("\n");
}

function sanitizeCombinedConcept(value, rationale) {
  const [core, ...relatedParts] = String(value ?? "").split(/\n\s*연결 개념\s*\n/);
  const connections = cleanConnections(relatedParts.join("\n"), core, rationale);
  return [core.trim(), connections ? `연결 개념\n${connections}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

function sentences(value) {
  return String(value ?? "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => normalizeKey(item).length >= 8);
}

function neutralizeOptionExplanation(value) {
  return String(value ?? "")
    .replace(/[⭕❌✅]\s*/g, "")
    .replace(/정답 기준(?:과 어긋난다|에 부합한다)\.?\s*/g, "")
    .replace(/이 선택지는 교사용 정답에 해당합니다\.?\s*/g, "")
    .replace(/‘[^’]+’은 이 회차에서 묻는 조건을 충족하지 않습니다\.?\s*/g, "")
    .replace(/따라서 이 회차에서 묻는 조건의 정답은 ‘[^’]+’입니다\.?\s*/g, "")
    .replace(/교사용 정답은 ‘[^’]+’이며,\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function enrichExplanation(clusterId, explanation) {
  const cluster = clusterById.get(clusterId);
  const questions = cluster?.occurrenceIds.map((id) => questionById.get(id)).filter(Boolean) ?? [];
  const representative = cluster && questionById.get(cluster.representativeId);
  if (!representative || !questions.length) return explanation;

  const contexts = new Map();
  for (const question of questions) {
    question.options.forEach((option, index) => {
      const key = normalizeKey(option) || plain(option).toLowerCase();
      if (!key) return;
      const context = contexts.get(key) ?? {
        option: plain(option),
        correct: false,
        wrong: false,
        correctOptions: new Set(),
      };
      if (index + 1 === question.answer) context.correct = true;
      else context.wrong = true;
      context.correctOptions.add(plain(question.options[question.answer - 1]));
      contexts.set(key, context);
    });
  }

  const factCandidates = [
    explanation.rationale,
    ...explanation.optionExplanations,
    ...sentences(explanation.concept),
  ].flatMap(sentences);

  const explainContext = (context) => {
    if (context.correct && !context.wrong) {
      return `이 선택지는 교사용 정답에 해당합니다. ${explanation.rationale}`;
    }
    const matchingFact = factCandidates
      .map((fact) => ({ fact, score: optionSimilarity(context.option, fact) }))
      .filter(({ score }) => score >= 0.12)
      .sort((left, right) => right.score - left.score)[0]?.fact;
    const correctOptions = [...context.correctOptions].filter(Boolean).join(" 또는 ");
    if (matchingFact && normalizeKey(matchingFact) !== normalizeKey(explanation.rationale)) {
      return `${matchingFact} 따라서 이 회차에서 묻는 조건의 정답은 ‘${correctOptions}’입니다.`;
    }
    return `‘${context.option}’은 이 회차에서 묻는 조건을 충족하지 않습니다. 교사용 정답은 ‘${correctOptions}’이며, ${explanation.rationale}`;
  };

  const details = explanation.optionDetails.map((detail) => ({ ...detail }));
  for (const context of contexts.values()) {
    const best = details
      .map((detail, index) => ({ index, score: optionSimilarity(context.option, detail.option) }))
      .sort((left, right) => right.score - left.score)[0];
    if (!best || best.score < 0.28) {
      details.push({ option: context.option, explanation: explainContext(context) });
    }
  }

  for (const detail of details) {
    const currentLength = normalizeKey(detail.explanation).length;
    if (currentLength >= 20) continue;
    const context = [...contexts.values()]
      .map((item) => ({ item, score: optionSimilarity(item.option, detail.option) }))
      .sort((left, right) => right.score - left.score)[0]?.item;
    if (!context) continue;
    detail.explanation = `${detail.explanation} ${explainContext(context)}`.trim();
  }

  let rationale = explanation.rationale;
  if (normalizeKey(rationale).length < 35) {
    const supportingConcept = sentences(explanation.concept).find(
      (line) => !normalizeKey(rationale).includes(normalizeKey(line)),
    );
    if (supportingConcept) rationale = `${rationale} ${supportingConcept}`;
  }

  let concept = sanitizeCombinedConcept(explanation.concept, rationale);
  if (normalizeKey(concept).length < 70) {
    const [coreConcept, relatedConcepts] = concept.split(/\n\s*연결 개념\s*\n/);
    concept = [
      `${coreConcept}\n\n핵심 정리\n${rationale}`.trim(),
      relatedConcepts ? `연결 개념\n${relatedConcepts.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  concept = sanitizeCombinedConcept(concept, rationale);

  const occurrenceOptionExplanations = {};
  for (const question of questions) {
    occurrenceOptionExplanations[question.id] = question.options.map((option, index) => {
      const exact = details.find((detail) => normalizeKey(detail.option) === normalizeKey(option));
      const closest = details
        .map((detail) => ({ detail, score: optionSimilarity(option, detail.option) }))
        .sort((left, right) => right.score - left.score)[0];
      const matched = exact ?? (closest?.score >= 0.55 ? closest.detail : undefined);
      const generatedFallback = /이 회차에서 묻는 조건|교사용 정답은/.test(
        matched?.explanation ?? "",
      );
      let text = generatedFallback ? "" : neutralizeOptionExplanation(matched?.explanation);
      const correct = index + 1 === question.answer;
      const correctOption = plain(question.options[question.answer - 1]);
      if (normalizeKey(text).length < 20) {
        text = correct
          ? `${text} ${rationale}`.trim()
          : `${text} ‘${plain(option)}’은 문제에서 요구한 조건에 해당하지 않습니다. 정답 선택지는 ‘${correctOption}’이며, ${rationale}`.trim();
      }
      return text;
    });
  }
  const optionExplanations = occurrenceOptionExplanations[representative.id];

  return {
    ...explanation,
    rationale,
    concept,
    optionExplanations,
    optionDetails: details,
    occurrenceOptionExplanations,
  };
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
    const connections = cleanConnections(
      richConnections || simpleConnections,
      concept,
      rationale,
    );
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

for (const [clusterId, override] of Object.entries(explanationOverrides)) {
  if (!explanations[clusterId]) {
    throw new Error(`${clusterId}: 보강 대상 해설이 원본 데이터에 없습니다.`);
  }
  const cluster = clusterById.get(clusterId);
  const representative = cluster && questionById.get(cluster.representativeId);
  if (!representative) {
    throw new Error(`${clusterId}: 대표 문항을 찾지 못했습니다.`);
  }
  if (!Array.isArray(override.optionExplanations) || override.optionExplanations.length !== 4) {
    throw new Error(`${clusterId}: 보강 선택지 해설은 4개여야 합니다.`);
  }
  const variantOptionDetails = Object.entries(override.variantOptionExplanations ?? {}).map(
    ([option, explanation]) => ({ option, explanation }),
  );
  explanations[clusterId] = {
    ...explanations[clusterId],
    ...override,
    optionDetails: [
      ...representative.options.map((option, index) => ({
        option,
        explanation: override.optionExplanations[index],
      })),
      ...variantOptionDetails,
    ],
    sourceNote: `PDF 원문 지문 대조 보강 · ${representative.sourceFile} · Q${representative.number}`,
    answer: representative.answer,
  };
}

for (const [clusterId, explanation] of Object.entries(explanations)) {
  explanations[clusterId] = enrichExplanation(clusterId, explanation);
}

const audit = {
  pages: files.length,
  explanations: Object.keys(explanations).length,
  overrides: Object.keys(explanationOverrides).length,
  missingRationale: Object.values(explanations).filter((item) => !item.rationale).length,
  incompleteOptions: Object.values(explanations).filter((item) => item.optionDetails.length < 4).length,
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
