FROM node:20-bookworm-slim

# Install CUPS and basic utilities
RUN apt-get update && apt-get install -y \
    cups \
    cups-client \
    cups-bsd \
    iproute2 \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Add user to lpadmin group for configuring printers without root on CUPS side
RUN usermod -aG lpadmin node

# Create an app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy app source code, including start.sh
COPY . .

# Ensure start.sh is executable
RUN chmod +x start.sh

# Expose port (Printy uses 3030 by default)
EXPOSE 3030

# Start command
CMD ["./start.sh"]
