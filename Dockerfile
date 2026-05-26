# Use the official lightweight Node.js active LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency definition files
COPY package.json yarn.lock* ./

# Install dependencies (including devDependencies for tsx/typescript execution)
RUN yarn install --frozen-lockfile || yarn install

# Copy the rest of the application code
COPY . .

# Expose the Fake MongoDB Port
EXPOSE 27017

# Start the server using tsx
CMD ["yarn", "start"]
