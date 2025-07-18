import easyocr
import cv2
import os
import time
import pyttsx3
import re
from googletrans import Translator

# Initialize OCR and translator
reader = easyocr.Reader(['ar'], gpu=False)
translator = Translator()

# Initialize Text-to-Speech engine
engine = pyttsx3.init()

def speak(text, lang='en'):
    voices = engine.getProperty('voices')
    for voice in voices:
        if lang.lower() in voice.name.lower() or lang.lower() in str(voice.languages).lower():
            engine.setProperty('voice', voice.id)
            break
    print(f"Speaking: {text}")
    engine.say(text)
    engine.runAndWait()

# Capture image from webcam
def capture_image(filename='captured.jpg'):
    cam = cv2.VideoCapture(0)
    if not cam.isOpened():
        print("Camera not found.")
        return None
    ret, frame = cam.read()
    cam.release()
    if ret:
        cv2.imwrite(filename, frame)
        print("Image captured.")
        return filename
    else:
        print("Failed to capture.")
        return None

# Preprocess image (grayscale, sharpen, threshold)
def preprocess_image(image_path):
    img = cv2.imread(image_path)
    if img is None:
        print("Could not read image.")
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
    sharp = cv2.dilate(gray, kernel, iterations=1)
    sharp = cv2.erode(sharp, kernel, iterations=1)
    thresh = cv2.adaptiveThreshold(sharp, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY, 11, 12)
    resized = cv2.resize(thresh, None, fx=1.8, fy=1.8, interpolation=cv2.INTER_LINEAR)
    processed_path = "processed.jpg"
    cv2.imwrite(processed_path, resized)
    return processed_path

# Clean Arabic text
def clean_arabic(text):
    return re.sub(r'[^\u0600-\u06FF\s]', '', text)

# Extract Arabic text
def extract_text(image_path):
    results = reader.readtext(image_path)
    filtered = [res[1] for res in results if res[2] > 0.6 and len(res[1]) >= 2]
    text = " ".join(filtered)
    return clean_arabic(text)

# Translate Arabic to English
def translate_text(text):
    try:
        translation = translator.translate(text, src='ar', dest='en')
        return translation.text
    except Exception as e:
        print("Translation failed:", e)
        return None

# MAIN FUNCTION
def main():
    print("Smart Glasses Translator")
    print("1. Capture from webcam")
    print("2. Load image from file")
    choice = input("Choose an option (1 or 2): ").strip()

    if choice == "1":
        image_path = capture_image()
    elif choice == "2":
        image_path = input("Enter full image path: ").strip()
    else:
        print("Invalid option.")
        return

    if image_path:
        time.sleep(1)
        processed_path = preprocess_image(image_path)
        if processed_path:
            arabic_text = extract_text(processed_path)
            if arabic_text.strip():
                print("Detected Arabic:", arabic_text)
                translated = translate_text(arabic_text)
                if translated:
                    print("Translation:", translated)
                    speak(translated, lang='en')
                else:
                    print("Could not translate.")
            else:
                print("No valid Arabic text found.")
        else:
            print("Image preprocessing failed.")
    else:
        print("No image available.")

if __name__ == "__main__":
    main()
