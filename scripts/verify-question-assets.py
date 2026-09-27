import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


APP_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = APP_ROOT / "source-data" / "question-source-assets.json"
BANK_PATH = APP_ROOT / "public" / "data" / "question-bank.json"
ASSET_ROOT = APP_ROOT / "public" / "question-assets"
CONTACT_ROOT = APP_ROOT.parent / "tmp" / "pdfs" / "question-assets-contact"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify() -> list[tuple[str, Path]]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    bank = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    bank_by_id = {question["id"]: question for question in bank["questions"]}
    verified = []

    for question_id, assets in manifest["questions"].items():
        if question_id not in bank_by_id:
            raise RuntimeError(f"Unknown question in manifest: {question_id}")
        if bank_by_id[question_id].get("sourceAssets") != assets:
            raise RuntimeError(f"Question bank asset metadata differs: {question_id}")
        for asset in assets:
            filename = Path(asset["src"]).name
            path = ASSET_ROOT / filename
            if not path.exists():
                raise RuntimeError(f"Missing asset: {path}")
            if file_sha256(path) != asset["sha256"]:
                raise RuntimeError(f"Checksum mismatch: {path}")
            with Image.open(path) as image:
                if image.size != (asset["width"], asset["height"]):
                    raise RuntimeError(f"Dimension mismatch: {path}")
                image.verify()
            verified.append((question_id, path))

    disk_files = {path.name for path in ASSET_ROOT.glob("*.png")}
    referenced_files = {path.name for _, path in verified}
    if disk_files != referenced_files:
        raise RuntimeError(
            f"Unreferenced or missing assets: disk-only={sorted(disk_files - referenced_files)}, "
            f"manifest-only={sorted(referenced_files - disk_files)}"
        )
    if len(verified) != bank["meta"]["sourceAssetCount"]:
        raise RuntimeError("Question bank sourceAssetCount is incorrect")
    if len(manifest["questions"]) != bank["meta"]["sourceAssetQuestionCount"]:
        raise RuntimeError("Question bank sourceAssetQuestionCount is incorrect")
    return verified


def build_contact_sheets(verified: list[tuple[str, Path]]) -> None:
    CONTACT_ROOT.mkdir(parents=True, exist_ok=True)
    items_per_sheet = 50
    cell_width = 360
    cell_height = 230
    columns = 5
    font = ImageFont.load_default()

    for sheet_index in range(math.ceil(len(verified) / items_per_sheet)):
        items = verified[sheet_index * items_per_sheet : (sheet_index + 1) * items_per_sheet]
        rows = math.ceil(len(items) / columns)
        sheet = Image.new("RGB", (cell_width * columns, cell_height * rows), "white")
        draw = ImageDraw.Draw(sheet)
        for index, (question_id, path) in enumerate(items):
            column = index % columns
            row = index // columns
            left = column * cell_width
            top = row * cell_height
            draw.rectangle(
                (left, top, left + cell_width - 1, top + cell_height - 1),
                outline="#94a3b8",
            )
            draw.text((left + 8, top + 6), question_id, fill="#0f172a", font=font)
            with Image.open(path) as source:
                image = source.convert("RGB")
                image.thumbnail((cell_width - 16, cell_height - 36), Image.Resampling.LANCZOS)
                x = left + (cell_width - image.width) // 2
                y = top + 28 + (cell_height - 34 - image.height) // 2
                sheet.paste(image, (x, y))
        output = CONTACT_ROOT / f"question-assets-{sheet_index + 1:02d}.jpg"
        sheet.save(output, format="JPEG", quality=90, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contact-sheets", action="store_true")
    args = parser.parse_args()
    verified = verify()
    if args.contact_sheets:
        build_contact_sheets(verified)
    print(
        json.dumps(
            {
                "verifiedQuestionCount": len({question_id for question_id, _ in verified}),
                "verifiedAssetCount": len(verified),
                "contactSheets": math.ceil(len(verified) / 50) if args.contact_sheets else 0,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
