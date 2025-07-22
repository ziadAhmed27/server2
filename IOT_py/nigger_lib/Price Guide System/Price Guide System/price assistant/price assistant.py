import torch
import torchvision.transforms as transforms
from torchvision.models import mobilenet_v2
from PIL import Image
import pyttsx3
import requests
from bs4 import BeautifulSoup
import os
import json

# ========== 1. Image Preprocessing ==========
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.5] * 3, [0.5] * 3)
])

# ========== 2. Paths & Constants ==========
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "..", "AI recognition model")
MODEL_DIR = os.path.abspath(MODEL_DIR)  # normalize full path
JSON_PATH = os.path.join(BASE_DIR, "vegetable_prices.json")

# ========== 3. Load Labels ==========
with open(os.path.join(MODEL_DIR, "labels.txt"), encoding="utf-8") as f:
    labels = [l.strip() for l in f]

# ========== 4. Load Model ==========
model = mobilenet_v2(weights=None)
model.classifier[1] = torch.nn.Linear(model.last_channel, len(labels))
model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "model_weights.pt"), map_location="cpu"))
model.eval()

# ========== 5. Voice Function ==========
def speak(text):
    t = pyttsx3.init()
    t.setProperty("rate", 150)
    t.say(text)
    t.runAndWait()

# ========== 6. Prediction ==========
def predict_image(path):
    try:
        img = Image.open(path).convert("RGB")
    except:
        speak("Cannot open image.")
        return None
    t = transform(img).unsqueeze(0)
    with torch.no_grad():
        idx = model(t).argmax(1).item()
    return labels[idx]

# ========== 7. Price Scraper ==========
def update_prices_json():
    url = "http://www.oboormarket.org.eg/Prices_ar.aspx"
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        res = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(res.text, "html.parser")
    except Exception as e:
        speak("Failed to connect to Obour Market website.")
        print("❌ Error fetching prices:", e)
        return

    cards = soup.find_all("div", class_="card")
    prices = {}

    for card in cards:
        try:
            name_tag = card.find("div", class_="card-header").find("h5")
            name = name_tag.get_text(strip=True) if name_tag else "اسم غير موجود"

            price_tags = card.find("div", class_="card-block").find_all("strong")
            min_price = price_tags[0].text.strip() if len(price_tags) > 0 else None
            max_price = price_tags[1].text.strip() if len(price_tags) > 1 else None

            if name and min_price and max_price:
                prices[name] = {"min": min_price, "max": max_price}
        except Exception as e:
            print("❌ Error parsing card:", e)

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(prices, f, ensure_ascii=False, indent=2)
    print(f"✅ Prices saved to '{JSON_PATH}'")

# ========== 8. Read Prices ==========
def get_vegetable_prices(arabic_label):
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return arabic_label, data[arabic_label]["min"], data[arabic_label]["max"]
    except KeyError:
        return None
    except FileNotFoundError:
        speak("Prices file not found.")
        return None

# ========== 9. Translation ==========
label_map = {
    "Tomato": "طماطم",
    "Onion": "بصل أحمر",
    "apple": "تفاح",
    "cucamber": "خيار بلدى"
}

# ========== 10. Main ==========
if __name__ == "__main__":
    update_prices_json()

    path = input("Enter image path: ").strip()
    if not os.path.exists(path):
        speak("Invalid image path.")
        exit()

    label = predict_image(path)
    if not label:
        exit()

    speak(f"I see {label}")
    arabic = label_map.get(label, label)

    result = get_vegetable_prices(arabic)
    if result:
        name, pmin, pmax = result
        msg = f"The price of {name} is between {pmin} and {pmax} Egyptian Pounds."
    else:
        msg = f"Sorry, {arabic} not found in the saved vegetable prices."

    print(msg)
    speak(msg)
