import hashlib
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image
from pypdf import PdfReader


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = APP_ROOT.parent
PDF_ROOT = WORKSPACE_ROOT / "필기_전체_교사용_2004-2026"
AUDIT_PATH = WORKSPACE_ROOT / "output" / "data" / "network_manager_2_source_fidelity_audit.json"
ASSET_ROOT = APP_ROOT / "public" / "question-assets"
MANIFEST_PATH = APP_ROOT / "source-data" / "question-source-assets.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    records = audit["imageQuestions"]
    by_file = defaultdict(list)
    for record in records:
        by_file[record["sourceFile"]].append(record)

    ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    manifest = {}
    written = set()

    for file_index, (source_file, questions) in enumerate(sorted(by_file.items()), start=1):
        print(f"[{file_index:02d}/{len(by_file):02d}] {source_file}", flush=True)
        reader = PdfReader(PDF_ROOT / source_file)
        page_images = {}

        for record in questions:
            assets = []
            for image_index, source_image in enumerate(
                sorted(record["images"], key=lambda item: (item["page"], item["top"], item["x0"])),
                start=1,
            ):
                page_number = source_image["page"]
                if page_number not in page_images:
                    page_images[page_number] = list(reader.pages[page_number - 1].images)
                candidates = [
                    image
                    for image in page_images[page_number]
                    if Path(image.name).stem == source_image["name"]
                ]
                if len(candidates) != 1:
                    raise RuntimeError(
                        f"Expected one image {source_image['name']} on {source_file} page {page_number}, "
                        f"found {len(candidates)}"
                    )
                source = candidates[0].image
                suffix = f"-{image_index}" if len(record["images"]) > 1 else ""
                filename = f"{record['id']}{suffix}.png"
                output_path = ASSET_ROOT / filename
                source.save(output_path, format="PNG", optimize=True)
                with Image.open(output_path) as saved:
                    if saved.size != source.size:
                        raise RuntimeError(f"Image size changed while saving {output_path}")
                    width, height = saved.size
                written.add(filename)
                assets.append(
                    {
                        "src": f"./question-assets/{filename}",
                        "width": width,
                        "height": height,
                        "sha256": sha256(output_path),
                        "sourceFile": source_file,
                        "page": page_number,
                        "sourceObject": source_image["name"],
                    }
                )
            manifest[record["id"]] = assets

    stale = sorted(path.name for path in ASSET_ROOT.glob("*.png") if path.name not in written)
    if stale:
        raise RuntimeError(
            "Stale question assets exist. Review before removal: " + ", ".join(stale[:10])
        )

    payload = {
        "meta": {
            "sourcePdfCount": len(by_file),
            "questionCount": len(manifest),
            "assetCount": sum(len(assets) for assets in manifest.values()),
            "format": "lossless PNG extracted from the original PDF image object",
        },
        "questions": dict(sorted(manifest.items())),
    }
    MANIFEST_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload["meta"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
