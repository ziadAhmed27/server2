import os
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


# ---------------------------
# PART 1: SCRAPE PRODUCT DATA
# ---------------------------
def scrape_prices():
    url = "http://www.oboormarket.org.eg/Prices_ar.aspx"
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        res = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(res.text, "html.parser")
    except Exception as e:
        print("❌ Error fetching prices:", e)
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
            print("❌ Error parsing card:", e)

    # Save Arabic labels
    with open(LABELS_FILE, "w", encoding="utf-8") as f:
        for name in product_names:
            f.write(name + "\n")

    # Save Arabic prices
    with open(PRICES_FILE, "w", encoding="utf-8") as f:
        json.dump(product_prices, f, ensure_ascii=False, indent=4)

    print(f"✅ Scraped {len(product_names)} products and saved to {LABELS_FILE} and {PRICES_FILE}.")
    return product_names, product_prices


# ---------------------------
# PART 2: BATCH TRANSLATION
# ---------------------------
def batch_translate_texts(texts, source_lang='ar', target_lang='en', batch_size=30):
    translated_texts = []
    translator = GoogleTranslator(source=source_lang, target=target_lang)

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        joined = " || ".join(batch)
        translated = translator.translate(joined)
        split_translated = [t.strip() for t in translated.split("||")]
        translated_texts.extend(split_translated)

    return translated_texts


def translate_labels():
    if not os.path.exists(LABELS_FILE):
        print(f"❌ File {LABELS_FILE} not found.")
        return

    with open(LABELS_FILE, "r", encoding="utf-8") as f:
        labels = [line.strip() for line in f if line.strip()]

    if not labels:
        print("❌ No labels found.")
        return

    print(f"Translating {len(labels)} labels...")
    translated_labels = batch_translate_texts(labels)

    with open(LABELS_FILE_EN, "w", encoding="utf-8") as f:
        for label in translated_labels:
            f.write(label + "\n")

    print(f"✅ Translated labels saved to {LABELS_FILE_EN}")


def translate_prices():
    if not os.path.exists(PRICES_FILE):
        print(f"❌ File {PRICES_FILE} not found.")
        return

    with open(PRICES_FILE, "r", encoding="utf-8") as f:
        prices = json.load(f)

    product_names = list(prices.keys())
    print(f"Translating {len(product_names)} product names in JSON...")

    translated_names = batch_translate_texts(product_names)

    translated_prices = {}
    for original, translated in zip(product_names, translated_names):
        translated_prices[translated] = prices[original]

    with open(PRICES_FILE_EN, "w", encoding="utf-8") as f:
        json.dump(translated_prices, f, ensure_ascii=False, indent=4)

    print(f"✅ Translated prices saved to {PRICES_FILE_EN}")


# ---------------------------
# PART 3: OPENCLIP IMAGE MATCHING
# ---------------------------
def recognize_product(image_path, labels_file=LABELS_FILE_EN, prices_file=PRICES_FILE_EN):
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image path not found: {image_path}")

    if not os.path.exists(labels_file):
        raise FileNotFoundError(f"Labels file not found: {labels_file}")

    if not os.path.exists(prices_file):
        raise FileNotFoundError(f"Prices file not found: {prices_file}")

    device = "cuda" if torch.cuda.is_available() else "cpu"

    print("\nLoading OpenCLIP model (ViT-B-32, laion2b_s34b_b79k)...")
    model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
    tokenizer = open_clip.get_tokenizer('ViT-B-32')
    model.to(device).eval()
    print("Model loaded successfully!")

    print(f"\nProcessing image: {image_path}")
    image = preprocess(Image.open(image_path)).unsqueeze(0).to(device)

    with open(labels_file, "r", encoding="utf-8") as f:
        labels = [line.strip() for line in f.readlines()]

    if not labels:
        print("Error: labels file is empty.")
        return

    text_tokens = tokenizer(labels).to(device)

    with torch.no_grad():
        image_features = model.encode_image(image)
        text_features = model.encode_text(text_tokens)

        image_features /= image_features.norm(dim=-1, keepdim=True)
        text_features /= text_features.norm(dim=-1, keepdim=True)

        similarity = (image_features @ text_features.T).squeeze(0)
        best_idx = similarity.argmax().item()
        best_label = labels[best_idx]

    with open(prices_file, "r", encoding="utf-8") as f:
        price_data = json.load(f)

    if best_label in price_data:
        min_price = price_data[best_label]["min"]
        max_price = price_data[best_label]["max"]
        print(f"\nThe product '{best_label}' price ranges from {min_price} to {max_price} EGP.")
    else:
        print(f"\nThe product '{best_label}' is not in the database.")


# ---------------------------
# MAIN EXECUTION
# ---------------------------
if __name__ == "__main__":
    # Step 1: Scrape Arabic data
    scrape_prices()

    # Step 2: Translate data
    translate_labels()
    translate_prices()

    # Step 3: Ask for image path
    image_path = input("\nEnter path to product image: ").strip().strip('"')
    recognize_product(image_path)
