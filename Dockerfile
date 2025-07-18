# Use a slim Node.js image as base
FROM node:18-slim

# Install FFmpeg and Python3 with pip
RUN apt-get update && apt-get install -y ffmpeg python3 python3-pip && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy only package files first for better layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Remove unnecessary files from the image
RUN rm -rf /app/node_modules/.cache /app/tests /app/test /app/docs /app/.git /app/.github

# Copy the rest of the app (including IOT_py)
COPY . .

# Install Python dependencies
RUN pip3 install --break-system-packages easyocr opencv-python googletrans==4.0.0-rc1 torch torchvision pillow

# Expose the port (Railway uses $PORT)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"] 