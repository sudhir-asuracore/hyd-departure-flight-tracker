# Use the official Puppeteer image which comes with Node.js and all necessary dependencies for Chromium.
# Pinning to a specific version is a good practice.
FROM ghcr.io/puppeteer/puppeteer:24.9.0

# Set the working directory in the container.
# The default user of this image ('pptruser') has permissions for /home/pptruser.
WORKDIR /home/pptruser/app

# Copy package.json and package-lock.json first to leverage Docker's layer caching.
# The npm dependencies will be re-installed only if these files change.
COPY package*.json ./

# Install dependencies using 'npm install'. While 'npm ci' is often preferred in CI,
# 'npm install' can be more resilient to transient network errors from the registry.
RUN npm install

# Copy the rest of your application's code.
COPY . .

# Expose the port the server will run on.
EXPOSE 3000

# The command to run the application.
# The puppeteer image runs as a non-root user 'pptruser' by default, which is a good security practice.
CMD ["node", "server.js"]
