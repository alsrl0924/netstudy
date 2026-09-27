import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import pdfplumber


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = APP_ROOT.parent
PDF_ROOT = WORKSPACE_ROOT / "필기_전체_교사용_2004-2026"
SOURCE_PATH = WORKSPACE_ROOT / "output" / "data" / "network_manager_2_questions.json"
REPORT_PATH = WORKSPACE_ROOT / "output" / "data" / "network_manager_2_source_fidelity_audit.json"

QUESTION_NUMBER = re.compile(r"^(?:[1-9]|[1-4][0-9]|50)\.$")
REFERENCE_TERMS = re.compile(
    r"(?:다음|아래|위)\s*(?:의|에|에서|은|는)?\s*"
    r"(?:지문|그림|도표|표|화면|결과|보기|구성도|파형|회로)|"
    r"\([A-Z]\)\s*(?:에|안|의)|빈\s*칸"
)


def normalized_words(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = re.sub(r"[①②③④❶❷❸❹]", " ", normalized)
    normalized = re.sub(r"[^0-9A-Za-z가-힣]+", " ", normalized)
    return [word.lower() for word in normalized.split() if len(word) > 1]


def clean_region_text(text: str) -> str:
    for marker in (
        "전자문제집 CBT 홈페이지",
        "기출문제 및 해설집 다운로드",
        "전자문제집 CBT란",
        "종이 문제집이 아닌",
    ):
        if marker in text:
            text = text.split(marker, 1)[0]
    lines = []
    for line in text.splitlines():
        if any(
            phrase in line
            for phrase in (
                "전자문제집 CBT",
                "최강 자격",
                "기출문제 및 해설집 다운로드",
                "종이 문제집이 아닌",
                "PC 버전 및 모바일 버전",
                "교사용/학생용 관리기능",
                "최신 수정된",
            )
        ):
            continue
        if "네트워크관리사 2급" in line and "필기 기출" in line:
            continue
        if re.match(r"^\s*\d과목\s*:", line):
            continue
        lines.append(line)
    if lines:
        lines[0] = re.sub(r"^\s*\d+\.\s*", "", lines[0])
    return "\n".join(lines)


def find_question_anchors(page) -> list[dict]:
    words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False)
    anchors = []
    mid = page.width / 2
    for word in words:
        text = word["text"].strip()
        if not QUESTION_NUMBER.fullmatch(text):
            continue
        number = int(text[:-1])
        column = 0 if word["x0"] < mid else 1
        relative_x = float(word["x0"]) - (mid if column else 0)
        anchors.append(
            {
                "number": number,
                "column": column,
                "x0": float(word["x0"]),
                "relativeX": relative_x,
                "top": float(word["top"]),
                "bottom": float(word["bottom"]),
            }
        )
    return anchors


def question_regions(pdf) -> dict[int, dict]:
    located = []
    for page_index, page in enumerate(pdf.pages):
        for anchor in find_question_anchors(page):
            located.append(
                {
                    "segment": page_index * 2 + anchor["column"],
                    "pageIndex": page_index,
                    **anchor,
                }
            )

    located.sort(key=lambda item: (item["segment"], item["top"]))
    anchors_by_number = {}
    for item in located:
        existing = anchors_by_number.get(item["number"])
        if existing is None or item["relativeX"] < existing["relativeX"]:
            anchors_by_number[item["number"]] = item

    def segment_bbox(segment: int, top: float, bottom: float) -> dict:
        page_index = segment // 2
        column = segment % 2
        page = pdf.pages[page_index]
        mid = page.width / 2
        return {
            "page": page_index + 1,
            "column": column,
            "bbox": [
                0.0 if column == 0 else float(mid),
                max(0.0, float(top)),
                float(mid) if column == 0 else float(page.width),
                min(float(page.height), float(bottom)),
            ],
        }

    regions = {}
    for number in range(1, 51):
        item = anchors_by_number.get(number)
        if not item:
            continue
        next_item = anchors_by_number.get(number + 1)
        start_segment = item["segment"]
        end_segment = next_item["segment"] if next_item else start_segment
        parts = []
        for segment in range(start_segment, end_segment + 1):
            page = pdf.pages[segment // 2]
            top = item["top"] - 3 if segment == start_segment else 45
            bottom = (
                next_item["top"] - 2
                if next_item and segment == end_segment
                else page.height - 28
            )
            if bottom > top:
                parts.append(segment_bbox(segment, top, bottom))
        regions[number] = {"parts": parts}
    return regions


def intersects(image: dict, bbox: list[float]) -> bool:
    x0, top, x1, bottom = bbox
    overlap_x = max(0, min(float(image["x1"]), x1) - max(float(image["x0"]), x0))
    overlap_y = max(0, min(float(image["bottom"]), bottom) - max(float(image["top"]), top))
    image_area = max(1, float(image["width"]) * float(image["height"]))
    return (overlap_x * overlap_y) / image_area >= 0.5


def audit_pdf(path: Path, questions: list[dict]) -> tuple[list[dict], list[dict]]:
    records = []
    errors = []
    with pdfplumber.open(path) as pdf:
        regions = question_regions(pdf)
        if len(regions) != 50:
            errors.append(
                {
                    "sourceFile": path.name,
                    "type": "question-region-count",
                    "found": len(regions),
                    "missing": sorted(set(range(1, 51)) - set(regions)),
                }
            )

        for question in questions:
            number = question["question_number"]
            region = regions.get(number)
            if not region:
                continue
            text_parts = []
            images = []
            for part in region["parts"]:
                page = pdf.pages[part["page"] - 1]
                bbox = part["bbox"]
                text_parts.append(
                    page.crop(tuple(bbox)).extract_text(x_tolerance=2, y_tolerance=3) or ""
                )
                images.extend(
                    {
                        "page": part["page"],
                        "column": part["column"],
                        "name": image.get("name"),
                        "x0": round(float(image["x0"]), 3),
                        "top": round(float(image["top"]), 3),
                        "x1": round(float(image["x1"]), 3),
                        "bottom": round(float(image["bottom"]), 3),
                        "width": round(float(image["width"]), 3),
                        "height": round(float(image["height"]), 3),
                        "srcWidth": int(image.get("srcsize", [0, 0])[0]),
                        "srcHeight": int(image.get("srcsize", [0, 0])[1]),
                    }
                    for image in page.images
                    if intersects(image, bbox)
                )
            region_text = "\n".join(text_parts)

            raw_words = normalized_words(question.get("raw_block", ""))
            raw_counts = defaultdict(int)
            for word in raw_words:
                raw_counts[word] += 1
            region_words = normalized_words(clean_region_text(region_text))
            region_counts = defaultdict(int)
            for word in region_words:
                region_counts[word] += 1
            extra_words = []
            seen_counts = defaultdict(int)
            for word in region_words:
                if word == str(number):
                    continue
                seen_counts[word] += 1
                if seen_counts[word] > raw_counts[word]:
                    extra_words.append(word)
            data_extra_words = []
            seen_counts.clear()
            for word in raw_words:
                seen_counts[word] += 1
                if seen_counts[word] > region_counts[word]:
                    data_extra_words.append(word)

            stem = question.get("stem", "")
            records.append(
                {
                    "id": f"{question['exam_date']}-q{number:02d}",
                    "sourceFile": path.name,
                    "examDate": question["exam_date_iso"],
                    "number": number,
                    "parts": [
                        {
                            **part,
                            "bbox": [round(value, 3) for value in part["bbox"]],
                        }
                        for part in region["parts"]
                    ],
                    "imageCount": len(images),
                    "images": images,
                    "referenceLanguage": bool(REFERENCE_TERMS.search(stem)),
                    "shortStem": len(re.sub(r"\s+", "", stem)) < 18,
                    "regionExtraWords": extra_words,
                    "dataExtraWords": data_extra_words,
                    "optionCount": len(question.get("options", [])),
                    "answer": question.get("answer"),
                    "regionText": region_text,
                    "stem": stem,
                }
            )
    return records, errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=REPORT_PATH)
    args = parser.parse_args()

    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    by_file = defaultdict(list)
    for question in source["questions"]:
        by_file[question["source_file"]].append(question)

    records = []
    errors = []
    for index, (source_file, questions) in enumerate(sorted(by_file.items()), start=1):
        path = PDF_ROOT / source_file
        print(f"[{index:02d}/{len(by_file):02d}] {source_file}", flush=True)
        if not path.exists():
            errors.append({"sourceFile": source_file, "type": "missing-pdf"})
            continue
        pdf_records, pdf_errors = audit_pdf(path, questions)
        records.extend(pdf_records)
        errors.extend(pdf_errors)

    image_records = [record for record in records if record["imageCount"]]
    # Q50 can continue into the next PDF column/page, while there is no Q51
    # anchor to bound that continuation. The source parser already follows the
    # continuation and preserves its text, so keep these as an explicit layout
    # diagnostic instead of reporting them as source-text mismatches.
    layout_continuations = [
        record
        for record in records
        if record["number"] == 50
        and not record["regionExtraWords"]
        and record["dataExtraWords"]
    ]
    text_mismatches = [
        record
        for record in records
        if (record["regionExtraWords"] or record["dataExtraWords"])
        and record not in layout_continuations
    ]
    invalid_options = [record for record in records if record["optionCount"] != 4]
    invalid_answers = [record for record in records if record["answer"] not in (1, 2, 3, 4)]
    suspicious_without_images = [
        record
        for record in records
        if not record["imageCount"]
        and (record["referenceLanguage"] or record["shortStem"] or record["regionExtraWords"])
    ]
    payload = {
        "summary": {
            "pdfCount": len(by_file),
            "questionCount": len(records),
            "questionImageCount": len(image_records),
            "embeddedImageCount": sum(record["imageCount"] for record in image_records),
            "suspiciousWithoutImagesCount": len(suspicious_without_images),
            "textWordMismatchCount": len(text_mismatches),
            "layoutContinuationCount": len(layout_continuations),
            "invalidOptionCount": len(invalid_options),
            "invalidAnswerCount": len(invalid_answers),
            "errorCount": len(errors),
        },
        "errors": errors,
        "textMismatches": text_mismatches,
        "layoutContinuations": layout_continuations,
        "invalidOptions": invalid_options,
        "invalidAnswers": invalid_answers,
        "imageQuestions": image_records,
        "suspiciousWithoutImages": suspicious_without_images,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
