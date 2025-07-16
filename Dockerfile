# Use a slim Node.js image as base
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy only package files first for better layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy the rest of the app
COPY . .

# Remove unnecessary files from the image
RUN rm -rf /app/node_modules/.cache /app/tests /app/test /app/docs /app/.git /app/.github /app/IOT_py

# Expose the port (Railway uses $PORT)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"] 