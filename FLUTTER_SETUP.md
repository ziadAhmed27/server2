# Flutter RTSP Stream Forwarder Setup Guide

This guide explains how to set up your Flutter mobile app to forward RTSP streams from ESP32-CAM to your cloud server.

## Architecture Overview

```
ESP32-CAM (Mobile Hotspot) → Flutter App → Cloud Server → Web Interface
```

1. **ESP32-CAM** connects to mobile phone hotspot
2. **Flutter App** receives RTSP stream from ESP32-CAM
3. **Flutter App** forwards stream to cloud server
4. **Cloud Server** processes and serves the stream
5. **Web Interface** displays the stream

## Prerequisites

### 1. ESP32-CAM Setup
- ESP32-CAM connected to mobile hotspot
- RTSP server running on port 8554
- Stream URL: `rtsp://192.168.1.7:8554/mjpeg/1`

### 2. Cloud Server
- Node.js server deployed (Railway, Heroku, etc.)
- FFmpeg installed on server
- Ports 3000 (HTTP) and 9999 (WebSocket) accessible

### 3. Flutter Development Environment
- Flutter SDK installed
- Android Studio / VS Code
- Physical device or emulator

## Flutter App Setup

### 1. Create New Flutter Project

```bash
flutter create rtsp_forwarder
cd rtsp_forwarder
```

### 2. Update pubspec.yaml

Replace your `pubspec.yaml` with the provided one or add these dependencies:

```yaml
dependencies:
  flutter:
    sdk: flutter
  http: ^1.1.0
  web_socket_channel: ^2.4.0
  dio: ^5.3.2
  shared_preferences: ^2.2.2
  connectivity_plus: ^5.0.2
  permission_handler: ^11.0.1
```

### 3. Install Dependencies

```bash
flutter pub get
```

### 4. Add the Main App Code

Replace your `lib/main.dart` with the provided `flutter_rtsp_forwarder.dart` code.

### 5. Android Permissions

Add these permissions to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

### 6. iOS Permissions (if needed)

Add to `ios/Runner/Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

## Usage Instructions

### 1. Deploy Your Server

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Deploy to cloud** (Railway, Heroku, etc.)

### 2. Configure Flutter App

1. **Open the Flutter app** on your mobile device
2. **Enter your server URL:**
   - Local testing: `http://localhost:3000`
   - Cloud deployment: `https://your-server.com`
3. **Enter ESP32-CAM RTSP URL:**
   - `rtsp://192.168.1.7:8554/mjpeg/1`
4. **Enter stream name:**
   - `flutter-cam-1`

### 3. Start Streaming

1. **Ensure ESP32-CAM is connected** to mobile hotspot
2. **Click "Start Forwarding"** in Flutter app
3. **Check logs** for connection status
4. **View stream** on server web interface

## API Endpoints for Flutter

### Start Stream
```http
POST /api/streams/start
Content-Type: application/json

{
  "rtspUrl": "rtsp://192.168.1.7:8554/mjpeg/1",
  "streamName": "flutter-cam-1"
}
```

### Health Check
```http
GET /api/streams/flutter-cam-1/health
```

### Stop Stream
```http
POST /api/streams/stop/flutter-cam-1
```

### Record Stream
```http
POST /api/streams/flutter-cam-1/record
Content-Type: application/json

{
  "duration": 60,
  "outputPath": "flutter_recording.mp4"
}
```

## Network Configuration

### Mobile Hotspot Setup

1. **Enable mobile hotspot** on your phone
2. **Connect ESP32-CAM** to the hotspot
3. **Note the IP address** assigned to ESP32-CAM
4. **Update RTSP URL** in Flutter app

### Testing Network Connectivity

Add this function to your Flutter app to test connectivity:

```dart
Future<bool> testRTSPConnection(String rtspUrl) async {
  try {
    // Basic connectivity test
    final uri = Uri.parse(rtspUrl.replaceFirst('rtsp://', 'http://'));
    final response = await http.get(uri).timeout(Duration(seconds: 5));
    return response.statusCode == 200;
  } catch (e) {
    print('RTSP connection test failed: $e');
    return false;
  }
}
```

## Troubleshooting

### Common Issues

1. **"Stream not found" error**
   - Check if ESP32-CAM is accessible from mobile device
   - Verify RTSP URL is correct
   - Ensure ESP32-CAM is connected to same hotspot

2. **"Connection failed" error**
   - Check server URL in Flutter app
   - Verify server is running and accessible
   - Check firewall settings

3. **"WebSocket connection failed"**
   - Ensure port 9999 is open on server
   - Check if stream is active
   - Verify WebSocket URL format

4. **Stream quality issues**
   - Adjust FFmpeg options in server.js
   - Check ESP32-CAM resolution settings
   - Monitor network bandwidth

### Debug Mode

Enable debug logging in Flutter:

```dart
// Add to your Flutter app
void enableDebugMode() {
  // Enable HTTP logging
  http.logging = true;
  
  // Add more detailed logging
  _addLog('Debug mode enabled', type: 'info');
}
```

## Advanced Features

### 1. Auto-Reconnection

The server includes auto-reconnection features:
- FFmpeg will automatically reconnect on connection loss
- Flutter app performs health checks every 30 seconds
- Stream status is monitored in real-time

### 2. Multiple Streams

You can run multiple streams simultaneously:
- Each stream gets a unique ID
- All streams are managed independently
- Web interface shows all active streams

### 3. Recording

Streams can be recorded to MP4 files:
- Specify duration and filename
- Files are saved in `recordings/` directory
- Automatic cleanup can be implemented

### 4. Real-time Monitoring

WebSocket connections provide real-time updates:
- Stream status changes
- Error notifications
- Performance metrics

## Security Considerations

1. **Authentication**: Add API keys or JWT tokens
2. **HTTPS**: Use HTTPS for production
3. **Rate Limiting**: Implement rate limiting
4. **Input Validation**: Validate all inputs
5. **Error Handling**: Don't expose sensitive information

## Production Deployment

### Server Deployment

1. **Use HTTPS** for all communications
2. **Set up environment variables** for configuration
3. **Implement logging** and monitoring
4. **Set up automatic backups**
5. **Configure firewall rules**

### Flutter App Deployment

1. **Build release version:**
   ```bash
   flutter build apk --release
   ```

2. **Test thoroughly** on physical devices
3. **Implement crash reporting** (Firebase Crashlytics)
4. **Add analytics** for usage monitoring
5. **Publish to app stores** if needed

## Example ESP32-CAM Code

Here's a basic ESP32-CAM setup for RTSP streaming:

```cpp
#include "esp_camera.h"
#include "WiFi.h"

// WiFi credentials
const char* ssid = "YourHotspotName";
const char* password = "YourPassword";

// Camera pins
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
  
  // Initialize camera
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return;
  }
  
  // Start RTSP server (you'll need to implement this)
  startRTSPServer();
}

void loop() {
  // Main loop
  delay(1000);
}
```

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review server logs
3. Test network connectivity
4. Verify all configurations 