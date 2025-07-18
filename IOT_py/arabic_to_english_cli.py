import sys
import easyocr
import cv2
import re
from googletrans import Translator

reader = easyocr.Reader(['ar'], gpu=False)
translator = Translator()

def clean_arabic(text):
    return re.sub(r'[^ -\u06FF\s]', '', text)

def preprocess_image(image_path):
    img = cv2.imread(image_path)
    if img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
    sharp = cv2.dilate(gray, kernel, iterations=1)
    sharp = cv2.erode(sharp, kernel, iterations=1)
    thresh = cv2.adaptiveThreshold(sharp, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY, 11, 12)
    resized = cv2.resize(thresh, None, fx=1.8, fy=1.8, interpolation=cv2.INTER_LINEAR)
    processed_path = "processed_tmp.jpg"
    cv2.imwrite(processed_path, resized)
    return processed_path

def extract_text(image_path):
    results = reader.readtext(image_path)
    filtered = [res[1] for res in results if res[2] > 0.6 and len(res[1]) >= 2]
    text = " ".join(filtered)
    return clean_arabic(text)

def translate_text(text):
    try:
        translation = translator.translate(text, src='ar', dest='en')
        return translation.text
    except Exception as e:
        return None

def main():
    if len(sys.argv) != 2:
        print("Usage: python arabic_to_english_cli.py <image_path>", file=sys.stderr)
        sys.exit(1)
    image_path = sys.argv[1]
    processed_path = preprocess_image(image_path)
    if not processed_path:
        print("Image preprocessing failed.", file=sys.stderr)
        sys.exit(2)
    arabic_text = extract_text(processed_path)
    if not arabic_text.strip():
        print("No valid Arabic text found.", file=sys.stderr)
        sys.exit(3)
    translated = translate_text(arabic_text)
    if translated:
        print(translated)
    else:
        print("Could not translate.", file=sys.stderr)
        sys.exit(4)

if __name__ == "__main__":
    main() 