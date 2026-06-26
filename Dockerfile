FROM apify/actor-node:22

COPY package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev \
    && echo "Node.js version:" \
    && node --version

COPY . ./

CMD npm start --silent
