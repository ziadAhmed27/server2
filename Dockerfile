# Use official Node.js image as base
FROM node:18

# Install Python3 and pip
RUN apt-get update && apt-get install -y python3 python3-pip

# Set python alias for compatibility
RUN ln -s /usr/bin/python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the code
COPY . .

# Install Python dependencies
RUN pip3 install --break-system-packages -r IOT_py/requirements.txt

# Expose the port (Railway uses $PORT)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"] 