# Use a slim Node.js image as base
FROM node:18-slim

# Install Python3 and pip, then clean up apt cache
RUN apt-get update && apt-get install -y python3 python3-pip && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy only package files first for better layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy only the necessary app files (exclude dev files, docs, etc.)
COPY . .

# Remove unnecessary files from the image
RUN rm -rf /app/node_modules/.cache /app/tests /app/test /app/docs /app/.git /app/.github

# Install Python dependencies
RUN pip3 install --break-system-packages -r IOT_py/requirements.txt

# Expose the port (Railway uses $PORT)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"] 