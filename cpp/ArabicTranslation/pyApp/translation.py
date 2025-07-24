import easyocr
import cv2
import os
import re
import pytesseract
import numpy as np
import sys
import json
from deep_translator import GoogleTranslator, exceptions
from time import time
from typing import Optional, Tuple, Union

class ArabicTranslator:
    def __init__(self):
        self.reader = None
        self.initialized = False
        self.initialize_ocr()
        
    def initialize_ocr(self) -> bool:
        """Initialize OCR engines with proper configuration and fallback"""
        try:
            self.reader = easyocr.Reader(
                ['ar'],
                gpu=True,
                quantize=True,
                model_storage_directory=None,
                download_enabled=True,
                verbose=False
            )
            self.initialized = True
            return True
        except Exception as e:
            print(f"EasyOCR initialization failed: {e}", file=sys.stderr)
            
        try:
            pytesseract.get_tesseract_version()
            self.initialized = True
            return True
        except:
            print("Tesseract not found in PATH", file=sys.stderr)
            
        return False

    def read_text_file(self, file_path: str) -> str:
        """Read text from a text file with proper encoding handling"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            try:
                with open(file_path, 'r', encoding='utf-16') as f:
                    return f.read()
            except Exception as e:
                print(f"Failed to read text file: {e}", file=sys.stderr)
                return ""
        except Exception as e:
            print(f"Error reading text file: {e}", file=sys.stderr)
            return ""

    def needs_preprocessing(self, image_path: str) -> bool:
        """Determine if image needs preprocessing"""
        try:
            img = cv2.imread(image_path)
            if img is None:
                return False
                
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            brightness = cv2.mean(gray)[0]
            contrast = gray.std()
            
            blur = cv2.Laplacian(gray, cv2.CV_64F).var()
            return brightness < 180 or contrast < 50 or blur < 100
        except Exception as e:
            print(f"Preprocessing check failed: {e}", file=sys.stderr)
            return False

    def smart_preprocess(self, image_path: str) -> Optional[np.ndarray]:
        """Enhanced adaptive preprocessing based on image content"""
        try:
            img = cv2.imread(image_path)
            if img is None:
                return None
                
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            brightness = cv2.mean(gray)[0]
            if brightness < 180:
                gray = cv2.equalizeHist(gray)
                
            if gray.std() < 50:
                clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
                gray = clahe.apply(gray)
                
            gray = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
            
            kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
            sharpened = cv2.filter2D(gray, -1, kernel)
            
            _, binary = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            return binary
        except Exception as e:
            print(f"Preprocessing failed: {e}", file=sys.stderr)
            return None

    def clean_arabic(self, text: str) -> str:
        """Enhanced Arabic text cleaning with more normalization"""
        if not text:
            return ""
        
        replacements = {
            'أ': 'ا',
            'إ': 'ا',
            'آ': 'ا',
            'ى': 'ي',
            'ة': 'ه',
            'ؤ': 'ء',
            'ئ': 'ء',
            'ٱ': 'ا',
            'ﻻ': 'لا',
            'ﻷ': 'لا',
            'ﻵ': 'لا',
            'ﻹ': 'لا'
        }
        
        for orig, repl in replacements.items():
            text = text.replace(orig, repl)
        
        text = re.sub(r'[\u064B-\u065F\u0670]', '', text)
        text = re.sub(r'[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s.,،:;؟!()0-9]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text

    def extract_text(self, image_data: Union[str, np.ndarray], use_easyocr: bool = True) -> str:
        """Unified text extraction function with better error handling"""
        if not self.initialized:
            return ""
            
        try:
            if use_easyocr and self.reader:
                results = self.reader.readtext(
                    image_data,
                    batch_size=32,
                    text_threshold=0.6,
                    link_threshold=0.4,
                    paragraph=True,
                    decoder='beamsearch',
                    beamWidth=5
                )
                return " ".join([res[1] for res in results if res[2] > 0.3])
            else:
                custom_config = r'--psm 6 --oem 3 -c tessedit_char_whitelist=ابتةثجحخدذرزسشصضطظعغفقكلمنهويءآأؤإئ.,،:;؟!()0123456789'
                return pytesseract.image_to_string(
                    image_data,
                    lang='ara',
                    config=custom_config
                )
        except Exception as e:
            print(f"Text extraction failed: {e}", file=sys.stderr)
            return ""

    def translate_text(self, text: str) -> str:
        """Robust translation with better chunking and error handling"""
        if not text.strip():
            return ""
        
        try:
            sentences = re.split(r'[.،;!؟]', text)
            sentences = [s.strip() for s in sentences if s.strip()]
            
            translated = []
            current_chunk = ""
            
            for sentence in sentences:
                if len(current_chunk) + len(sentence) < 4500:
                    current_chunk += sentence + ". "
                else:
                    try:
                        translated.append(GoogleTranslator(source='auto', target='en').translate(current_chunk))
                        current_chunk = sentence + ". "
                    except exceptions.TranslationNotFound:
                        translated.append(current_chunk)
                    except Exception as e:
                        print(f"Translation error: {e}", file=sys.stderr)
                        translated.append(current_chunk)
            
            if current_chunk:
                try:
                    translated.append(GoogleTranslator(source='auto', target='en').translate(current_chunk))
                except:
                    translated.append(current_chunk)
            
            return " ".join(translated)
        except Exception as e:
            print(f"Translation process failed: {e}", file=sys.stderr)
            return ""

    def process_input(self, input_arg: str) -> Tuple[str, str]:
        """Main processing function that handles both text and image inputs"""
        arabic_text = ""
        
        # Check if input is a file path
        if os.path.exists(input_arg):
            # Check if it's a text file
            if input_arg.lower().endswith('.txt'):
                arabic_text = self.read_text_file(input_arg)
            else:
                # Process as image
                if not self.needs_preprocessing(input_arg):
                    img_data = cv2.imread(input_arg)
                    arabic_text = self.extract_text(img_data)
                else:
                    processed = self.smart_preprocess(input_arg)
                    if processed is not None:
                        arabic_text = self.extract_text(processed)
                
                # Fallback to Tesseract if needed
                if not arabic_text.strip():
                    img_data = cv2.imread(input_arg) if not self.needs_preprocessing(input_arg) else self.smart_preprocess(input_arg)
                    if img_data is not None:
                        arabic_text = self.extract_text(img_data, use_easyocr=False)
        else:
            # Process as direct text input
            arabic_text = self.clean_arabic(input_arg)
        
        arabic_text = self.clean_arabic(arabic_text)
        translation = self.translate_text(arabic_text) if arabic_text.strip() else ""
        
        return arabic_text, translation

def main():
    # Configure Tesseract path if not in system PATH
    try:
        pytesseract.get_tesseract_version()
    except:
        possible_paths = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"/usr/bin/tesseract",
            r"/usr/local/bin/tesseract"
        ]
        for path in possible_paths:
            if os.path.exists(path):
                pytesseract.pytesseract.tesseract_cmd = path
                break
    
    # Force UTF-8 output
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python translation.py <path_to_image_or_txt> or \"arabic text\""}))
        return
    
    input_arg = sys.argv[1]
    translator = ArabicTranslator()
    
    if not translator.initialized:
        print(json.dumps({"error": "No working OCR engines available"}))
        return
    
    start_time = time()
    
    try:
        arabic_text, translation = translator.process_input(input_arg)
        
        if not arabic_text.strip():
            print(json.dumps({"error": "No valid Arabic text could be extracted"}))
            return
        
        if not translation.strip():
            print(json.dumps({"error": "Translation returned empty result"}))
            return
            
        result = {
            "arabic_text": arabic_text,
            "english_translation": translation,
            "processing_time": round(time() - start_time, 2)
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": f"Processing failed: {str(e)}"}))

if __name__ == "__main__":
    main()