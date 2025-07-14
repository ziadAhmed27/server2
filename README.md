# Customer Management Server

## Features
- Customer signup/signin with SQLite database
- Stores customer info, trip history, and risk status
- Image-to-English translation endpoint using EasyOCR and Google Translate (Python)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Install Python dependencies (in the IOT_py folder):
   ```bash
   pip install easyocr googletrans==4.0.0-rc1 opencv-python-headless pyttsx3
   ```
3. Start the server:
   ```bash
   node server.js
   ```

## Deployment (Railway.com)
- Ensure Railway supports both Node.js and Python (for the OCR feature).
- Add a `PYTHONPATH` environment variable if needed.
- Make sure the `IOT_py/Arabic_to_Engish_talking.py` script and all dependencies are present.
- The `/api/translate-image` endpoint requires Python and the listed packages.
- Uploaded images are stored in the `uploads/` directory (ignored by git).

## API
### POST `/api/customers/signup`
- Body: `{ name, email, password, nationality, currently_in_egypt, date_of_arrival?, date_of_leaving? }`
- Creates a new customer.

### POST `/api/customers/signin`
- Body: `{ email, password }`
- Returns customer info if credentials are correct.

### POST `/api/translate-image`
- Form-data: `image` (image file)
- Returns: `{ translation: "..." }`

--- 