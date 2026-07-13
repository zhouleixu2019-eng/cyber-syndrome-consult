import json
import re
from pathlib import Path

from pypdf import PdfReader


SOURCE_DIR = Path(r"C:\Users\DELL\Desktop\CPST空间下的网络综合征\AI for Cyber-syndrome （1+4）")

PRIMARY_SOURCES = [
    {
        "key": "formation-classification-recovery-prevention",
        "title": "Cyber-Syndrome and its Formation, Classification, Recovery, and Prevention",
        "file": "1. Cyber-Syndrome_and_its_Formation_Classification_Recovery_and_Prevention.pdf",
    },
    {
        "key": "concept-theoretical-characterization-control",
        "title": "Cyber-Syndrome Concept, Theoretical Characterization, and Control Mechanism",
        "file": "2. Cyber-Syndrome_Concept_Theoretical_Characterization_and_Control_Mechanism.pdf",
    },
    {
        "key": "tree-based-corpus",
        "title": "A tree-based corpus annotated with Cyber-Syndrome, symptoms, symptoms, and acupoints",
        "file": "3. a tree-based corpus annotated with Cyber-Syndrome, symptoms, symptoms, and acupoints.pdf",
    },
    {
        "key": "cpst-maslow-tutorial",
        "title": "A Tutorial of Cyber-Syndrome viewed from CPST Space and Maslow's Hierarchy of Needs",
        "file": "4. A Tutorial of Cyber-Syndrome viewed from Cyber-Physical-Social-Thinking Space and Maslow's Hierarchy of Needs.pdf",
    },
    {
        "key": "hyperthermia-robots",
        "title": "Application of hyperthermia robots in Cyber-syndrome",
        "file": "Application of hyperthermia robots in Cyber-syndrome.pdf",
    },
]


def clean_text(text: str) -> str:
    text = text.replace("\u0000", " ")
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_page_text(page_texts, target_size=1300, overlap=220):
    chunks = []
    current = ""
    start_page = 1
    end_page = 1

    for page_number, page_text in page_texts:
        if not page_text:
            continue
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", page_text) if p.strip()]
        for paragraph in paragraphs:
            if not current:
                start_page = page_number
            if len(current) + len(paragraph) + 2 <= target_size:
                current = f"{current}\n\n{paragraph}".strip()
                end_page = page_number
                continue

            if current:
                chunks.append(
                    {
                        "pageStart": start_page,
                        "pageEnd": end_page,
                        "text": clean_text(current),
                    }
                )
                tail = current[-overlap:] if overlap and len(current) > overlap else ""
                current = f"{tail}\n\n{paragraph}".strip()
                start_page = page_number
                end_page = page_number
            else:
                chunks.append(
                    {
                        "pageStart": page_number,
                        "pageEnd": page_number,
                        "text": clean_text(paragraph[:target_size]),
                    }
                )
                current = paragraph[target_size - overlap :]
                start_page = page_number
                end_page = page_number

    if current:
        chunks.append(
            {
                "pageStart": start_page,
                "pageEnd": end_page,
                "text": clean_text(current),
            }
        )

    return [chunk for chunk in chunks if len(chunk["text"]) >= 80]


def extract_pdf(source):
    pdf_path = SOURCE_DIR / source["file"]
    reader = PdfReader(str(pdf_path))
    page_texts = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            text = clean_text(page.extract_text() or "")
        except Exception:
            text = ""
        page_texts.append((index, text))

    chunks = chunk_page_text(page_texts)
    for chunk_index, chunk in enumerate(chunks, start=1):
        chunk.update(
            {
                "id": f"{source['key']}:{chunk_index}",
                "sourceKey": source["key"],
                "sourceTitle": source["title"],
                "fileName": pdf_path.name,
                "filePath": str(pdf_path),
            }
        )
    return {
        "key": source["key"],
        "title": source["title"],
        "fileName": pdf_path.name,
        "filePath": str(pdf_path),
        "pageCount": len(reader.pages),
        "chunkCount": len(chunks),
        "chunks": chunks,
    }


def main():
    output_dir = Path(__file__).resolve().parents[1] / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    documents = []
    chunks = []
    all_sources = PRIMARY_SOURCES

    for source in all_sources:
        pdf_path = SOURCE_DIR / source["file"]
        if not pdf_path.exists():
            print(f"Skip missing PDF: {pdf_path}")
            continue
        print(f"Extracting: {pdf_path.name}")
        document = extract_pdf(source)
        documents.append({k: v for k, v in document.items() if k != "chunks"})
        chunks.extend(document["chunks"])

    corpus = {
        "generatedAt": "2026-06-30",
        "sourceDirectory": str(SOURCE_DIR),
        "documents": documents,
        "chunks": chunks,
    }

    output_file = output_dir / "cyber_syndrome_knowledge.json"
    output_file.write_text(json.dumps(corpus, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(chunks)} chunks from {len(documents)} documents to {output_file}")


if __name__ == "__main__":
    main()
