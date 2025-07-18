import os
import sys
import torch
import torchvision.transforms as transforms
from torchvision.models import mobilenet_v2
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Load label map
with open(os.path.join(SCRIPT_DIR, "labels.txt"), "r", encoding="utf-8") as f:
    labels = [line.strip() for line in f]
# Load model and weights
model = mobilenet_v2(weights=None)
model.classifier[1] = torch.nn.Linear(model.last_channel, len(labels))
model.load_state_dict(torch.load(os.path.join(SCRIPT_DIR, "model_weights.pt"), map_location=torch.device("cpu")))
model.eval()

# Image preprocessing
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.5]*3, [0.5]*3)
])

def load_script(label):
    path = os.path.join(SCRIPT_DIR, "scripts", f"{label}.txt")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    return "I see something interesting, but I don't have a description for it."

def predict_image(image_path):
    img = Image.open(image_path).convert("RGB")
    img_tensor = transform(img).unsqueeze(0)
    with torch.no_grad():
        output = model(img_tensor)
        pred_idx = output.argmax(dim=1).item()
        label = labels[pred_idx]
    description = load_script(label)
    return label, description

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python place_recognizer_cli.py <image_path>", file=sys.stderr)
        sys.exit(1)
    img_path = sys.argv[1]
    if not os.path.exists(img_path):
        print("Image path not found.", file=sys.stderr)
        sys.exit(2)
    label, description = predict_image(img_path)
    print(label)
    print(description) 