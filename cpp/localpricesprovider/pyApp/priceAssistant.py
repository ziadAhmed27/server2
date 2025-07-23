import os
import sys
import json
import torch
from PIL import Image
from bs4 import BeautifulSoup
import requests
import open_clip
from deep_translator import GoogleTranslator

# Configuration
LABELS_FILE = os.path.join(os.path.dirname(__file__), "labels.txt")
PRICES_FILE = os.path.join(os.path.dirname(__file__), "prices.json")
LABELS_FILE_EN = os.path.join(os.path.dirname(__file__), "labels_en.txt")
PRICES_FILE_EN = os.path.join(os.path.dirname(__file__), "prices_en.json")
THRESHOLD = 0.28

def scrape_prices():
    try:
        url = "http://www.oboormarket.org.eg/Prices_ar.aspx"
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(res.text, "html.parser")

        product_names = []
        product_prices = {}

        for card in soup.find_all("div", class_="card"):
            try:
                name = card.find("div", class_="card-header").find("h5").get_text(strip=True)
                prices = card.find("div", class_="card-block").find_all("strong")
                min_price = prices[0].text.strip() if len(prices) > 0 else "N/A"
                max_price = prices[1].text.strip() if len(prices) > 1 else min_price

                if name and min_price != "N/A":
                    product_names.append(name)
                    product_prices[name] = {"min": min_price, "max": max_price}
            except Exception:
                continue

        with open(LABELS_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(product_names))

        with open(PRICES_FILE, "w", encoding="utf-8") as f:
            json.dump(product_prices, f, ensure_ascii=False, indent=2)

        return True
    except Exception as e:
        return False

def translate_data():
    try:
        # Translate labels
        with open(LABELS_FILE, "r", encoding="utf-8") as f:
            labels = [line.strip() for line in f if line.strip()]

        translated = GoogleTranslator(source='ar', target='en').translate_batch(labels)
        
        with open(LABELS_FILE_EN, "w", encoding="utf-8") as f:
            f.write("\n".join(translated))

        # Translate prices
        with open(PRICES_FILE, "r", encoding="utf-8") as f:
            prices = json.load(f)

        translated_prices = {}
        for name in prices:
            translated_name = GoogleTranslator(source='ar', target='en').translate(name)
            translated_prices[translated_name] = prices[name]

        with open(PRICES_FILE_EN, "w", encoding="utf-8") as f:
            json.dump(translated_prices, f, ensure_ascii=False, indent=2)

        return True
    except Exception:
        return False

def recognize_product(image_path):
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, _, preprocess = open_clip.create_model_and_transforms(
            'ViT-B-32', pretrained='laion2b_s34b_b79k')
        tokenizer = open_clip.get_tokenizer('ViT-B-32')
        model.to(device).eval()

        image = preprocess(Image.open(image_path)).unsqueeze(0).to(device)

        with open(LABELS_FILE_EN, "r", encoding="utf-8") as f:
            labels = [line.strip() for line in f]

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

        with open(PRICES_FILE_EN, "r", encoding="utf-8") as f:
            prices = json.load(f)

        result = {
            "detected": best_score >= THRESHOLD,
            "confidence": float(best_score),
            "label": best_label,
            "in_database": best_label in prices
        }

        if result["in_database"]:
            result.update(prices[best_label])

        return result
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python priceAssistant.py <image_path>"}))
        sys.exit(1)

    try:
        # Ensure data files exist and are fresh
        if not os.path.exists(LABELS_FILE) or not os.path.exists(PRICES_FILE):
            scrape_prices()
        if not os.path.exists(LABELS_FILE_EN) or not os.path.exists(PRICES_FILE_EN):
            translate_data()

        # Process image
        result = recognize_product(sys.argv[1])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Processing failed: {str(e)}"}))