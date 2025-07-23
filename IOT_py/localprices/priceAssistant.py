import os
import sys
import json
import torch
from PIL import Image
from bs4 import BeautifulSoup
import requests
import open_clip
from deep_translator import GoogleTranslator

LABELS_FILE = "labels.txt"
PRICES_FILE = "prices.json"
LABELS_FILE_EN = "labels_en.txt"
PRICES_FILE_EN = "prices_en.json"

def scrape_prices():
    url = "http://www.oboormarket.org.eg/Prices_ar.aspx"
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        res = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(res.text, "html.parser")
    except Exception as e:
        print(json.dumps({"error": f"Error fetching prices: {str(e)}"}))
        return [], {}

    product_names = []
    product_prices = {}

    cards = soup.find_all("div", class_="card")
    for card in cards:
        try:
            name_tag = card.find("div", class_="card-header").find("h5")
            name = name_tag.get_text(strip=True) if name_tag else None

            price_tags = card.find("div", class_="card-block").find_all("strong")
            min_price = price_tags[0].text.strip() if len(price_tags) > 0 else None
            max_price = price_tags[1].text.strip() if len(price_tags) > 1 else min_price

            if name and min_price:
                product_names.append(name)
                product_prices[name] = {"min": min_price, "max": max_price}
        except Exception as e:
            print(json.dumps({"error": f"Error parsing card: {str(e)}"}))

    try:
        with open(LABELS_FILE, "w", encoding="utf-8") as f:
            for name in product_names:
                f.write(name + "\n")

        with open(PRICES_FILE, "w", encoding="utf-8") as f:
            json.dump(product_prices, f, ensure_ascii=False, indent=4)
    except Exception as e:
        print(json.dumps({"error": f"Error saving files: {str(e)}"}))

    return product_names, product_prices

def batch_translate_texts(texts, source_lang='ar', target_lang='en', batch_size=30):
    translated_texts = []
    translator = GoogleTranslator(source=source_lang, target=target_lang)

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        try:
            joined = " || ".join(batch)
            translated = translator.translate(joined)
            split_translated = [t.strip() for t in translated.split("||")]
            translated_texts.extend(split_translated)
        except Exception as e:
            print(json.dumps({"error": f"Translation error: {str(e)}"}))
            translated_texts.extend(batch)  # Fallback to original text

    return translated_texts

def translate_labels():
    if not os.path.exists(LABELS_FILE):
        return False

    try:
        with open(LABELS_FILE, "r", encoding="utf-8") as f:
            labels = [line.strip() for line in f if line.strip()]

        if not labels:
            return False

        translated_labels = batch_translate_texts(labels)

        with open(LABELS_FILE_EN, "w", encoding="utf-8") as f:
            for label in translated_labels:
                f.write(label + "\n")
        return True
    except Exception as e:
        print(json.dumps({"error": f"Label translation failed: {str(e)}"}))
        return False

def translate_prices():
    if not os.path.exists(PRICES_FILE):
        return False

    try:
        with open(PRICES_FILE, "r", encoding="utf-8") as f:
            prices = json.load(f)

        product_names = list(prices.keys())
        translated_names = batch_translate_texts(product_names)

        translated_prices = {}
        for original, translated in zip(product_names, translated_names):
            translated_prices[translated] = prices[original]

        with open(PRICES_FILE_EN, "w", encoding="utf-8") as f:
            json.dump(translated_prices, f, ensure_ascii=False, indent=4)
        return True
    except Exception as e:
        print(json.dumps({"error": f"Price translation failed: {str(e)}"}))
        return False

def recognize_product(image_path, labels_file=LABELS_FILE_EN, prices_file=PRICES_FILE_EN):
    try:
        if not os.path.exists(image_path):
            return {"error": f"Image path not found: {image_path}"}
        
        if not os.path.exists(labels_file):
            return {"error": f"Labels file not found: {labels_file}"}
        
        if not os.path.exists(prices_file):
            return {"error": f"Prices file not found: {prices_file}"}

        device = "cuda" if torch.cuda.is_available() else "cpu"

        model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
        tokenizer = open_clip.get_tokenizer('ViT-B-32')
        model.to(device).eval()

        image = preprocess(Image.open(image_path)).unsqueeze(0).to(device)

        with open(labels_file, "r", encoding="utf-8") as f:
            labels = [line.strip() for line in f.readlines()]

        if not labels:
            return {"error": "Labels file is empty"}

        text_tokens = tokenizer(labels).to(device)

        with torch.no_grad():
            image_features = model.encode_image(image)
            text_features = model.encode_text(text_tokens)

            image_features /= image_features.norm(dim=-1, keepdim=True)
            text_features /= text_features.norm(dim=-1, keepdim=True)

            similarity = (image_features @ text_features.T).squeeze(0)
            best_idx = similarity.argmax().item()
            best_score = similarity[best_idx].item()
            best_label = labels[best_idx]

        THRESHOLD = 0.28
        if best_score < THRESHOLD:
            return {
                "detected": False,
                "confidence": best_score,
                "error": f"No product detected (confidence: {best_score:.2f})"
            }

        with open(prices_file, "r", encoding="utf-8") as f:
            price_data = json.load(f)

        result = {
            "detected": True,
            "label": best_label,
            "confidence": best_score,
            "in_database": best_label in price_data
        }

        if best_label in price_data:
            result["min_price"] = price_data[best_label]["min"]
            result["max_price"] = price_data[best_label]["max"]
        else:
            result["error"] = "Product not in database"

        return result

    except Exception as e:
        return {"error": f"Recognition failed: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python priceAssistant.py <path_to_image>"}))
        sys.exit(1)

    image_path = sys.argv[1]
    
    try:
        # Step 1: Scrape Arabic data
        scrape_prices()
        
        # Step 2: Translate data
        translate_labels()
        translate_prices()
        
        # Step 3: Recognize product from image
        result = recognize_product(image_path)
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {str(e)}"}))