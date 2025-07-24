import easyocr
import cv2
import os
import re
import pytesseract
import numpy as np
import sys
import json
from deep_translator import GoogleTranslator
from time import time

def initialize_ocr():
    """Initialize OCR engines with proper configuration"""
    try:
        reader = easyocr.Reader(
            ['ar'],
            gpu=True,
            quantize=True,
            model_storage_directory=None,
            download_enabled=True,
            verbose=False
        )
        return reader
    except Exception as e:
        print(f"EasyOCR initialization failed: {e}")
        return None

def needs_preprocessing(image_path):
    """Determine if image needs preprocessing"""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return False
            
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        brightness = cv2.mean(gray)[0]
        contrast = gray.std()
        
        return brightness < 180 or contrast < 50
    except:
        return False

def smart_preprocess(image_path):
    """Adaptive preprocessing based on image content"""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
            
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        if cv2.mean(gray)[0] < 180:
            gray = cv2.equalizeHist(gray)
            
        if gray.std() < 50:
            gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8)).apply(gray)
            
        kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
        sharpened = cv2.filter2D(gray, -1, kernel)
        
        return sharpened
    except:
        return None

def clean_arabic(text):
    """Enhanced Arabic text cleaning"""
    if not text:
        return ""
    
    replacements = {
        'أ': 'ا',
        'إ': 'ا',
        'آ': 'ا',
        'ى': 'ي',
        'ة': 'ه',
        'ؤ': 'ء',
        'ئ': 'ء'
    }
    for orig, repl in replacements.items():
        text = text.replace(orig, repl)
    
    text = re.sub(r'[\u064B-\u065F]', '', text)
    text = re.sub(r'[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s.,،:;؟!()0-9]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

def extract_text(reader, image_data, use_easyocr=True):
    """Unified text extraction function"""
    if use_easyocr and reader:
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
    else:
        try:
            return pytesseract.image_to_string(
                image_data,
                lang='ara',
                config='--psm 6 --oem 3'
            )
        except:
            return ""

def translate_text(text):
    """Robust translation with error handling"""
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

def main():
    # Configure Tesseract path if not in system PATH
    try:
        pytesseract.get_tesseract_version()
    except:
        tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
    
    # Force UTF-8 output
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python translation.py <path_to_image> or \"arabic text\""}))
        return
    
    input_arg = sys.argv[1]
    reader = initialize_ocr()
    if not reader and not pytesseract.get_tesseract_version():
        print(json.dumps({"error": "No working OCR engines available"}))
        return
    
    start_time = time()
    arabic_text = ""
    
    # Determine if input is text or image
    if os.path.exists(input_arg):
        # Process as image
        if not needs_preprocessing(input_arg):
            img_data = cv2.imread(input_arg)
            arabic_text = extract_text(reader, img_data)
        else:
            processed = smart_preprocess(input_arg)
            if processed is not None:
                arabic_text = extract_text(reader, processed)
        
        # Fallback to Tesseract if needed
        if not arabic_text.strip():
            img_data = cv2.imread(input_arg) if not needs_preprocessing(input_arg) else smart_preprocess(input_arg)
            if img_data is not None:
                arabic_text = extract_text(reader, img_data, use_easyocr=False)
    else:
        # Process as direct text input
        arabic_text = clean_arabic(input_arg)
    
    arabic_text = clean_arabic(arabic_text)
    if not arabic_text.strip():
        print(json.dumps({"error": "No valid Arabic text could be extracted"}))
        return
    
    # Translate
    translation = translate_text(arabic_text)
    
    if translation.strip():
        result = {
            "arabic_text": arabic_text,
            "english_translation": translation
        }
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({"error": "Translation returned empty result"}))

if __name__ == "__main__":
    main()