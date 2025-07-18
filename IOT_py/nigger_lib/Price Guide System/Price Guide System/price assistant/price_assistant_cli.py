import torch
import torchvision.transforms as transforms
from torchvision.models import mobilenet_v2
from PIL import Image
import os
import json
import sys
import unicodedata

# ========== 1. Image Preprocessing ==========
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.5] * 3, [0.5] * 3)
])

# ========== 2. Paths & Constants ==========
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "..", "AI recognition model")
MODEL_DIR = os.path.abspath(MODEL_DIR)
JSON_PATH = os.path.join(BASE_DIR, "vegetable_prices.json")

def normalize(s):
    return unicodedata.normalize('NFC', s.strip())

# ========== 3. Load Labels ==========
with open(os.path.join(MODEL_DIR, "labels.txt"), encoding="utf-8") as f:
    labels = [l.strip() for l in f]

# ========== 4. Load Model ==========
model = mobilenet_v2(weights=None)
model.classifier[1] = torch.nn.Linear(model.last_channel, len(labels))
model.load_state_dict(torch.load(os.path.join(MODEL_DIR, "model_weights.pt"), map_location="cpu"))
model.eval()

# ========== 5. Prediction ==========
def predict_image(path):
    try:
        img = Image.open(path).convert("RGB")
    except:
        print("Cannot open image.", file=sys.stderr)
        return None
    t = transform(img).unsqueeze(0)
    with torch.no_grad():
        idx = model(t).argmax(1).item()
    return labels[idx]

# ========== 6. Read Prices ==========
def get_vegetable_prices(arabic_label):
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Normalize all keys and the lookup
        data = {normalize(k): v for k, v in data.items()}
        nlabel = normalize(arabic_label)
        print("Available keys:", list(data.keys()), file=sys.stderr)
        print("Lookup key:", repr(nlabel), file=sys.stderr)
        return nlabel, data[nlabel]["min"], data[nlabel]["max"]
    except KeyError:
        return None
    except FileNotFoundError:
        print("Prices file not found.", file=sys.stderr)
        return None

# ========== 7. Translation ==========
label_map = {
    "Tomato": "طماطم",
    "Onion": "بصل أحمر",
    "apple": "تفاح",
    "cucamber": "خيار بلدى"
}

# ========== 8. Main ==========
def main():
    if len(sys.argv) < 2:
        print("Usage: python price_assistant_cli.py <image_path | vegetable_name>", file=sys.stderr)
        sys.exit(1)
    arg = sys.argv[1]
    if os.path.exists(arg):
        # Image path
        label = predict_image(arg)
        if not label:
            print("Could not recognize vegetable.", file=sys.stderr)
            sys.exit(2)
        arabic = label_map.get(label, label)
    else:
        # Direct text
        arabic = arg.strip()
    result = get_vegetable_prices(arabic)
    if result:
        name, pmin, pmax = result
        msg = f"{name}: {pmin} - {pmax} EGP"
    else:
        msg = f"Sorry, {arabic} not found in the saved vegetable prices."
    print(msg)

if __name__ == "__main__":
    main() 