# Customer Management & ESP32 Video Stream Server

## Features
- Customer signup/signin with SQLite database
- Stores customer info, trip history, and risk status
- Receives live video frames from ESP32-CAM and streams to browser

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```
3. Visit `http://localhost:3000` for the stream viewer.

## API
### POST `/api/customers/signup`
- Body: `{ name, email, password, nationality, currently_in_egypt, date_of_arrival?, date_of_leaving? }`
- Creates a new customer.

### POST `/api/customers/signin`
- Body: `{ email, password }`
- Returns customer info if credentials are correct.

### POST `/api/stream/:customerId/frame`
- Form-data: `frame` (JPEG image)
- ESP32 uploads frames here.

### GET `/api/stream/:customerId`
- Returns MJPEG stream for browser viewing.

## ESP32-CAM Integration
- The ESP32 should POST JPEG frames to `/api/stream/{customerId}/frame` as form-data with key `frame`.
- See `esp32_cam.ino` for example Arduino code.

---

## Example ESP32-CAM Arduino Code
See `esp32_cam.ino` in this repo for a working example. 