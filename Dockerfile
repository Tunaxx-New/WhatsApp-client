FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Git dependencies -> HTTPS instead of SSH
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

COPY package*.json ./

RUN npm install

COPY src ./src

CMD ["npm", "start"]