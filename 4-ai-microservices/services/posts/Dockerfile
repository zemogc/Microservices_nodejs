FROM node:22-alpine

WORKDIR /srv
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
