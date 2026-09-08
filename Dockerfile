FROM node:18

WORKDIR /app

# Pinned in .d2-version (shared with deploy.yml) so an upstream d2 release
# never changes rendering behavior under us — see the "install d2" step in
# deploy.yml for what happened when this tracked "latest".
COPY .d2-version ./
RUN curl -fsSL https://d2lang.com/install.sh | sh -s -- --version "$(cat .d2-version)"

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY . .

CMD node server.js
