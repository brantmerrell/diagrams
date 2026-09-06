FROM node:18

WORKDIR /app

RUN curl -fsSL https://d2lang.com/install.sh | sh -s --

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY server.js ./
COPY scripts/ ./scripts/
COPY tech/ ./tech/
COPY classes.d2 ./
COPY tags.d2 ./
COPY class_legend.d2 ./
COPY icons/ ./icons/
COPY pointers.yaml ./

CMD node server.js
