FROM node:18

WORKDIR /app

# Install d2
RUN curl -fsSL https://d2lang.com/install.sh | sh -s --

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY tech/ ./tech/
COPY pointers.yaml ./

CMD node server.js
