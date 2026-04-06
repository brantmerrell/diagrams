FROM node:18

WORKDIR /app

# Install d2
RUN curl -fsSL https://d2lang.com/install.sh | sh -s --

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY d2/ ./d2/
COPY src.yaml ./

CMD node server.js
