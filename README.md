# RTSP Streaming Server

A Node.js server that can receive, view, and record RTSP streams from ESP32-CAM or other RTSP sources.

## Features

- ✅ **RTSP Stream Reception**: Accept RTSP streams from mobile devices or cameras
- ✅ **Web Interface**: Beautiful web UI for viewing and managing streams
- ✅ **Stream Recording**: Record streams to MP4 files
- ✅ **Multiple Streams**: Handle multiple concurrent streams
- ✅ **Real-time Viewing**: WebSocket-based real-time video streaming
- ✅ **Mobile Support**: Mobile-friendly web interface

## Prerequisites

- Node.js (v14 or higher)
- FFmpeg installed on your system
- ESP32-CAM or other RTSP source

### Installing FFmpeg

**Windows:**
```bash
# Using chocolatey
choco install ffmpeg

# Or download from https://ffmpeg.org/download.html
```

**macOS:**
```bash
# Using homebrew
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install ffmpeg
```

## Installation

1. **Clone or download the project**
2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

The server will run on:
- **HTTP Server**: `http://localhost:3000`
- **WebSocket Server**: `ws://localhost:9999`

## Usage

### 1. Web Interface

Open `http://localhost:3000` in your browser to access the web interface.

**Features:**
- Start/stop RTSP streams
- View live video streams
- Record streams to files
- Monitor stream status

### 2. API Endpoints

#### Start a Stream
```bash
POST /api/streams/start
Content-Type: application/json

{
  "rtspUrl": "rtsp://192.168.1.7:8554/mjpeg/1",
  "streamName": "esp32-cam-1"
}
```

#### Stop a Stream
```bash
POST /api/streams/stop/:streamId
```

#### List All Streams
```bash
GET /api/streams
```

#### Get Stream Status
```bash
GET /api/streams/:streamId
```

#### Record a Stream
```bash
POST /api/streams/:streamId/record
Content-Type: application/json

{
  "duration": 60,
  "outputPath": "recording.mp4"
}
```

### 3. Mobile App Integration

Use the provided `mobile-app-example.html` as a template for your mobile application:

1. **Open the mobile app** on your phone/tablet
2. **Enter your server URL** (e.g., `https://your-server.com`)
3. **Enter the RTSP URL** from your ESP32-CAM
4. **Click "Start Forwarding"** to begin streaming
5. **View the stream** on your server's web interface

## ESP32-CAM Setup

### Basic ESP32-CAM Configuration

Your ESP32-CAM should be configured to:
1. Connect to WiFi (mobile hotspot or router)
2. Start an RTSP server on port 8554
3. Stream MJPEG format

### Example ESP32-CAM Code

```cpp
#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "img_converters.h"
#include "Arduino.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// Camera configuration
camera_config_t config;
config.ledc_channel = LEDC_CHANNEL_0;
config.ledc_timer = LEDC_TIMER_0;
config.pin_d0 = 5;
config.pin_d1 = 18;
config.pin_d2 = 19;
config.pin_d3 = 21;
config.pin_d4 = 36;
config.pin_d5 = 39;
config.pin_d6 = 34;
config.pin_d7 = 35;
config.pin_xclk = 0;
config.pin_pclk = 22;
config.pin_vsync = 25;
config.pin_href = 23;
config.pin_sscb_sda = 26;
config.pin_sscb_scl = 27;
config.pin_pwdn = 32;
config.pin_reset = -1;
config.xclk_freq_hz = 20000000;
config.pixel_format = PIXFORMAT_JPEG;
config.frame_size = FRAMESIZE_VGA;
config.jpeg_quality = 12;
config.fb_count = 1;

// Initialize camera
esp_err_t camera_init() {
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return err;
  }
  return ESP_OK;
}
```

## Network Configuration

### For Local Network Access

If your ESP32-CAM is on the same network as your server:
- Use the local IP address: `rtsp://192.168.1.7:8554/mjpeg/1`

### For Remote Access

If your ESP32-CAM is on a different network (e.g., mobile hotspot):

1. **Port Forwarding** (if possible):
   - Forward port 8554 on your router to the ESP32-CAM
   - Use your public IP: `rtsp://your-public-ip:8554/mjpeg/1`

2. **VPN Solution**:
   - Set up a VPN between networks
   - Use the VPN IP address

3. **Tunnel Solution**:
   - Use ngrok, FRP, or similar tunneling service
   - Create a tunnel to the ESP32-CAM's RTSP port

## File Structure

```
server2/
├── server.js              # Main server file
├── package.json           # Dependencies
├── public/
│   └── index.html        # Web interface
├── mobile-app-example.html # Mobile app template
├── recordings/           # Recorded video files
└── routes/
    └── customers.js      # Existing routes
```

## Troubleshooting

### Common Issues

1. **FFmpeg not found**
   - Install FFmpeg and ensure it's in your system PATH
   - Restart your terminal/command prompt

2. **Stream connection failed**
   - Check if the RTSP URL is correct
   - Verify the ESP32-CAM is accessible from your server
   - Check firewall settings

3. **WebSocket connection failed**
   - Ensure port 9999 is open
   - Check if the stream is active

4. **Recording not working**
   - Verify FFmpeg is installed
   - Check disk space in the recordings directory
   - Ensure the stream is active before recording

### Debug Mode

Enable debug logging by setting the environment variable:
```bash
DEBUG=* npm start
```

## Security Considerations

- ⚠️ **RTSP streams are not encrypted by default**
- ⚠️ **Avoid exposing RTSP ports directly to the internet**
- ✅ **Use VPN or tunneling for remote access**
- ✅ **Implement authentication for production use**
- ✅ **Use HTTPS for the web interface in production**

## Production Deployment

For production deployment:

1. **Use HTTPS** for the web interface
2. **Implement authentication** for stream management
3. **Set up proper logging** and monitoring
4. **Use a reverse proxy** (nginx, Apache)
5. **Configure firewall rules** appropriately
6. **Set up automatic backups** for recordings

## License

This project is open source and available under the ISC License. 