FROM node:22-bookworm-slim
WORKDIR /gateway
COPY package*.json ./
RUN npm ci --omit=dev
COPY . ./
USER node
ENV NODE_ENV=production PORT=8080
CMD ["node","gateway.mjs"]
