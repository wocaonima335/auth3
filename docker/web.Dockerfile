FROM node:24-alpine

WORKDIR /app
COPY . .

CMD ["node", "apps/web/src/server.js"]
