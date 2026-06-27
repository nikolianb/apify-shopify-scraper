FROM apify/actor-node:22

COPY package*.json ./

RUN npm --quiet set progress=false \
    && npm install --include=dev \
    && echo "Node.js version:" \
    && node --version

COPY . ./

RUN npm run build \
    && npm prune --omit=dev

CMD npm start --silent
