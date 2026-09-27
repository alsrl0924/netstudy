import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(appRoot, "..");
const sourceDir = path.join(workspaceRoot, "output", "data");
const outputDir = path.join(appRoot, "public", "data");

const raw = JSON.parse(
  await readFile(path.join(sourceDir, "network_manager_2_questions.json"), "utf8"),
);
const clustered = JSON.parse(
  await readFile(path.join(sourceDir, "network_manager_2_clusters.json"), "utf8"),
);

class DisjointSet {
  constructor() {
    this.parents = new Map();
  }

  find(value) {
    if (!this.parents.has(value)) this.parents.set(value, value);
    const parent = this.parents.get(value);
    if (parent !== value) this.parents.set(value, this.find(parent));
    return this.parents.get(value);
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents.set(rightRoot, leftRoot);
  }
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function readReviewRows(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const logicalRows = [];
  let buffer = "";
  let quoteCount = 0;

  for await (const physicalLine of lines) {
    buffer = buffer ? `${buffer}\n${physicalLine}` : physicalLine.replace(/^\uFEFF/, "");
    quoteCount += [...physicalLine].filter((character) => character === '"').length;
    if (quoteCount % 2 === 0) {
      logicalRows.push(buffer);
      buffer = "";
      quoteCount = 0;
    }
  }

  const headers = parseCsvLine(logicalRows.shift());
  return logicalRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(row)[index] ?? ""])),
  );
}

const reviews = await readReviewRows(
  path.join(sourceDir, "network_manager_2_duplicate_manual_review.csv"),
);
const dsu = new DisjointSet();
for (const row of reviews) {
  if (row.manual_decision === "병합 권장") dsu.union(row.cluster_a, row.cluster_b);
}

const clusterById = new Map(clustered.clusters.map((cluster) => [cluster.cluster_id, cluster]));
const exactToOriginalCluster = new Map();
for (const cluster of clustered.clusters) {
  exactToOriginalCluster.set(cluster.representative.exact_key, cluster.cluster_id);
  for (const variant of cluster.variants) exactToOriginalCluster.set(variant.exact_key, cluster.cluster_id);
}

const componentMembers = new Map();
for (const cluster of clustered.clusters) {
  const root = dsu.find(cluster.cluster_id);
  const members = componentMembers.get(root) ?? [];
  members.push(cluster.cluster_id);
  componentMembers.set(root, members);
}

const finalIdByOriginal = new Map();
for (const members of componentMembers.values()) {
  const sorted = [...members].sort((left, right) => {
    const a = clusterById.get(left);
    const b = clusterById.get(right);
    return (
      b.last_seen.localeCompare(a.last_seen) ||
      b.total_count - a.total_count ||
      left.localeCompare(right)
    );
  });
  const finalId = sorted[0];
  for (const member of members) finalIdByOriginal.set(member, finalId);
}

const questions = raw.questions
  .map((question) => {
    const originalClusterId = exactToOriginalCluster.get(question.exact_key);
    const clusterId = finalIdByOriginal.get(originalClusterId) ?? originalClusterId;
    const id = `${question.exam_date}-q${String(question.question_number).padStart(2, "0")}`;
    return {
      id,
      clusterId,
      examDate: question.exam_date_iso,
      year: question.year,
      round: question.round,
      number: question.question_number,
      subject: question.subject,
      stem: question.stem,
      options: question.options.map((option) => option.text),
      answer: question.answer,
      sourceFile: question.source_file,
    };
  })
  .sort(
    (left, right) =>
      left.examDate.localeCompare(right.examDate) || left.number - right.number,
  );

const questionsByCluster = new Map();
for (const question of questions) {
  const members = questionsByCluster.get(question.clusterId) ?? [];
  members.push(question);
  questionsByCluster.set(question.clusterId, members);
}

const grades = (totalCount, recentCount) => {
  const score = totalCount + recentCount * 2;
  if (score >= 8) return { grade: "S", score };
  if (score >= 4) return { grade: "A", score };
  if (score >= 2) return { grade: "B", score };
  return { grade: "C", score };
};

const latestYear = Math.max(...questions.map((question) => question.year));
const recentFiveStart = latestYear - 4;
const clusters = [...questionsByCluster.entries()]
  .map(([id, members]) => {
    const sorted = [...members].sort(
      (left, right) =>
        right.examDate.localeCompare(left.examDate) || right.number - left.number,
    );
    const latest = sorted[0];
    const recentCount = members.filter((question) => question.year >= recentFiveStart).length;
    const frequency = grades(members.length, recentCount);
    return {
      id,
      subject: latest.subject,
      representativeId: latest.id,
      occurrenceIds: members.map((question) => question.id),
      totalCount: members.length,
      recentFiveCount: recentCount,
      firstSeen: members[0].examDate,
      lastSeen: latest.examDate,
      grade: frequency.grade,
      frequencyScore: frequency.score,
    };
  })
  .sort(
    (left, right) =>
      right.frequencyScore - left.frequencyScore ||
      right.lastSeen.localeCompare(left.lastSeen),
  );

const exams = [];
const examMap = new Map();
for (const question of questions) {
  const key = question.examDate;
  if (!examMap.has(key)) {
    const exam = {
      date: question.examDate,
      year: question.year,
      round: question.round,
      questionIds: [],
    };
    examMap.set(key, exam);
    exams.push(exam);
  }
  examMap.get(key).questionIds.push(question.id);
}

const subjects = [...new Set(questions.map((question) => question.subject))];
const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    sourcePdfCount: new Set(questions.map((question) => question.sourceFile)).size,
    questionCount: questions.length,
    uniqueQuestionCount: clusters.length,
    examCount: exams.length,
    firstYear: Math.min(...questions.map((question) => question.year)),
    latestYear,
  },
  subjects,
  exams,
  clusters,
  questions,
};

await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, "question-bank.json"),
  JSON.stringify(payload),
  "utf8",
);

console.log(
  JSON.stringify({
    output: path.join(outputDir, "question-bank.json"),
    questions: questions.length,
    clusters: clusters.length,
    exams: exams.length,
    subjects,
  }),
);
