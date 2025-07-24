import easyocr
import cv2
import os
import re
import pytesseract
import json
import sys
from deep_translator import GoogleTranslator
from time import time

def initialize_ocr():
    """Initialize OCR engine with optimized settings"""
    return easyocr.Reader(
        ['ar'],
        gpu=True,
        quantize=True,
        model_storage_directory=None,
        download_enabled=True,
        verbose=False
    )

def clean_arabic(text):
    """Optimized Arabic text cleaning"""
    if not text:
        return ""
    
    replacements = {
        'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ى': 'ي',
        'ة': 'ه', 'ؤ': 'ء', 'ئ': 'ء'
    }
    for orig, repl in replacements.items():
        text = text.replace(orig, repl)
    
    text = re.sub(r'[\u064B-\u065F]', '', text)
    text = re.sub(r'[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s.,،:;؟!()0-9]', '', text)
    return re.sub(r'\s+', ' ', text).strip()

def extract_text(reader, image_path):
    """Fast text extraction with EasyOCR"""
    try:
        results = reader.readtext(
            image_path,
            batch_size=16,
            text_threshold=0.5,
            link_threshold=0.4,
            paragraph=True
        )
        return " ".join([res[1] for res in results if res[2] > 0.4])
    except Exception as e:
        print(f"OCR error: {e}", file=sys.stderr)
        return ""

def translate_text(text):
    """Optimized translation with chunking"""
    if not text.strip():
        return ""
    
    try:
        chunks = [text[i:i+4500] for i in range(0, len(text), 4500)]
        translated = []
        for chunk in chunks:
            try:
                translated.append(GoogleTranslator(source='ar', target='en').translate(chunk))
            except Exception as e:
                print(f"Translation chunk error: {e}", file=sys.stderr)
                translated.append(chunk)
        return " ".join(translated)
    except Exception as e:
        print(f"Translation error: {e}", file=sys.stderr)
        return ""

def process_json(json_path):
    """Process JSON file and return text"""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return clean_arabic(data.get('arabic_text', data.get('text', '')))
    except Exception as e:
        print(f"Error reading JSON file: {e}", file=sys.stderr)
        return ""

def main(input_path):
    # Initialize OCR only if needed (for image processing)
    reader = None
    if input_path.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp')):
        try:
            reader = initialize_ocr()
            arabic_text = extract_text(reader, input_path)
            if not arabic_text.strip():
                # Fallback to Tesseract if EasyOCR fails
                try:
                    img = cv2.imread(input_path)
                    arabic_text = pytesseract.image_to_string(img, lang='ara')
                except:
                    pass
        except Exception as e:
            return json.dumps({
                "arabic_text": "",
                "english_translation": "",
                "error": f"OCR initialization failed: {str(e)}"
            })
    elif input_path.lower().endswith('.json'):
        arabic_text = process_json(input_path)
    else:
        return json.dumps({
            "arabic_text": "",
            "english_translation": "",
            "error": "Unsupported file type"
        })

    arabic_text = clean_arabic(arabic_text)
    if not arabic_text.strip():
        return json.dumps({
            "arabic_text": "",
            "english_translation": "",
            "error": "No Arabic text could be extracted"
        })

    # Translate
    translation = translate_text(arabic_text)
    
    # Return as JSON
    return json.dumps({
        "arabic_text": arabic_text,
        "english_translation": translation,
        "error": ""
    })

if __name__ == "__main__":
    # Configure Tesseract path if not in system PATH
    try:
        pytesseract.get_tesseract_version()
    except:
        tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
    
    if len(sys.argv) != 2:
        print(json.dumps({
            "arabic_text": "",
            "english_translation": "",
            "error": "Usage: python translation.py <path_to_image_or_json>"
        }))
        sys.exit(1)
    
    try:
        result = main(sys.argv[1])
        print(result)
    except Exception as e:
        print(json.dumps({
            "arabic_text": "",
            "english_translation": "",
            "error": f"Processing error: {str(e)}"
        }))
        sys.exit(1)