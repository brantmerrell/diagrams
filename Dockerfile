FROM node:18

WORKDIR /app

# Install d2
RUN curl -fsSL https://d2lang.com/install.sh | sh -s --

# Install bun — dependencies are installed from the committed bun.lock, not
# resolved fresh, so the container gets exactly what was tested locally.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY server.js ./
COPY scripts/ ./scripts/
COPY tech/ ./tech/
COPY pointers.yaml ./

CMD node server.js
