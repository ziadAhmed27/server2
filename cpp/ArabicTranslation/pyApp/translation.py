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
        gpu=True,  # Always try to use GPU if available
        quantize=True,
        model_storage_directory=None,
        download_enabled=True,
        verbose=False
    )

def needs_preprocessing(image_path):
    """Quick check if image needs preprocessing"""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return False
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return cv2.mean(gray)[0] < 180 or gray.std() < 50
    except:
        return False

def smart_preprocess(image_path):
    """Fast preprocessing with essential steps only"""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if cv2.mean(gray)[0] < 180:
            gray = cv2.equalizeHist(gray)
        if gray.std() < 50:
            gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8)).apply(gray)
        return gray
    except:
        return None

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

def extract_text(reader, image_data):
    """Fast text extraction with EasyOCR"""
    try:
        results = reader.readtext(
            image_data,
            batch_size=16,
            text_threshold=0.5,
            link_threshold=0.4,
            paragraph=True
        )
        return " ".join([res[1] for res in results if res[2] > 0.4])
    except:
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
            except:
                translated.append(chunk)
        return " ".join(translated)
    except Exception as e:
        print(f"Translation error: {e}")
        return ""

def process_image(reader, image_path):
    """Process image file and return extracted text"""
    start_time = time()
    
    if not needs_preprocessing(image_path):
        img_data = cv2.imread(image_path)
        arabic_text = extract_text(reader, img_data)
    else:
        processed = smart_preprocess(image_path)
        if processed is not None:
            arabic_text = extract_text(reader, processed)
    
    if not arabic_text.strip():
        img_data = cv2.imread(image_path) if not needs_preprocessing(image_path) else smart_preprocess(image_path)
        if img_data is not None:
            arabic_text = pytesseract.image_to_string(img_data, lang='ara', config='--psm 6 --oem 3')
    
    arabic_text = clean_arabic(arabic_text)
    print(f"Text extraction completed in {time()-start_time:.2f} seconds")
    return arabic_text

def process_json(json_path):
    """Process JSON file and return text"""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return clean_arabic(data.get('text', ''))
    except Exception as e:
        print(f"Error reading JSON file: {e}")
        return ""

def main(input_path):
    print("\n=== Arabic Text Translator ===")
    
    # Initialize OCR only if needed (for image processing)
    reader = None
    if input_path.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp')):
        try:
            reader = initialize_ocr()
        except Exception as e:
            print(f"OCR initialization error: {e}")
            return
    
    start_time = time()
    
    # Process input based on file type
    if input_path.lower().endswith('.json'):
        arabic_text = process_json(input_path)
    else:
        if not os.path.exists(input_path):
            print("\nError: File not found")
            return
        arabic_text = process_image(reader, input_path)
    
    if not arabic_text.strip():
        print("\nError: No valid Arabic text could be extracted")
        return
    
    print("\n=== Extracted Arabic Text ===")
    print(arabic_text)
    
    # Translate
    print("\nTranslating...")
    translation = translate_text(arabic_text)
    
    if translation.strip():
        print("\n=== English Translation ===")
        print(translation)
        
        with open("translation_result.txt", "w", encoding="utf-8") as f:
            f.write(f"Arabic Text:\n{arabic_text}\n\nEnglish Translation:\n{translation}")
        print("\nResults saved to 'translation_result.txt'")
    else:
        print("\nWarning: Translation returned empty result")
    
    print(f"\nTotal processing time: {time()-start_time:.2f} seconds")

if __name__ == "__main__":
    # Configure Tesseract path if not in system PATH
    try:
        pytesseract.get_tesseract_version()
    except:
        tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
    
    if len(sys.argv) != 2:
        print("Usage: python translation.py <path_to_image_or_json>")
        sys.exit(1)
    
    main(sys.argv[1])