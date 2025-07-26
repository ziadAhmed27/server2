import os
import sys
import torch
from PIL import Image
import torchvision.transforms as transforms
import open_clip
import re
import json

# Set device
device = "cuda" if torch.cuda.is_available() else "cpu"

# Load CLIP model and preprocessing
model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
tokenizer = open_clip.get_tokenizer('ViT-B-32')
model.to(device)
model.eval()

# Accept image path as command-line argument
if len(sys.argv) != 2:
    print("Usage: python predict.py <image_path>", file=sys.stderr)
    sys.exit(1)
image_path = sys.argv[1]
if not os.path.exists(image_path):
    print("Image file not found.", file=sys.stderr)
    sys.exit(2)

# Load and preprocess image
try:
    image = preprocess(Image.open(image_path)).unsqueeze(0).to(device)
except Exception as e:
    print(f"Failed to load image: {e}", file=sys.stderr)
    sys.exit(3)

# Load labels and descriptions
try:
    labels_path = os.path.join(os.path.dirname(__file__), "labels.txt")
    with open(labels_path, "r", encoding="utf-8") as f:
        content = f.read()
except Exception as e:
    print(f"Failed to load labels.txt: {e}", file=sys.stderr)
    sys.exit(4)

# Split the file into blocks separated by blank lines
label_blocks = content.strip().split("\n\n")

# Extract label names and full descriptions
label_data = []
for block in label_blocks:
    lines = block.splitlines()
    if not lines:
        continue
    label_name = lines[0].strip()
    description = ' '.join(line.strip() for line in lines[1:]) if len(lines) > 1 else ""
    label_data.append({
        "label": label_name,
        "description": description
    })

# Use descriptions for matching
descriptions = [item["description"] for item in label_data]

# Tokenize descriptions
text_inputs = tokenizer(descriptions).to(device)

# Encode image and text
with torch.no_grad():
    image_features = model.encode_image(image)
    text_features = model.encode_text(text_inputs)

    # Normalize features
    image_features /= image_features.norm(dim=-1, keepdim=True)
    text_features /= text_features.norm(dim=-1, keepdim=True)

    # Compute similarity
    similarity = (image_features @ text_features.T).squeeze(0)

# Get top match index and label data
top_index = similarity.argmax().item()
result = label_data[top_index]

# Clean the output text
def clean_text(text):
    text = text.replace('’', "'")  # Replace smart quote with ASCII apostrophe
    text = re.sub(r'[^\x00-\x7F]', '', text)  # Remove any other non-ASCII chars
    return text

# Output result as JSON with label and description
output = {
    "label": clean_text(result["label"]),
    "description": clean_text(result["description"])
}

print(json.dumps(output))